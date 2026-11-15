import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { students } from '../core/core.schema.js';
import { TenantDb } from '../db/tenant-db.js';
import { EventStatus, EventStatusView, utc } from '../events/event-status.js';
import { Outbox } from '../events/outbox.js';

export interface Acceptance {
  applicationId: string;
  studentId: string;
}

export interface Application {
  id: string;
  applicantName: string;
  status: string;
  studentId: string | null;
  acceptedAt: string | null;
}

interface ApplicationRow extends Record<string, unknown> {
  id: string;
  applicant_name: string;
  status: string;
  student_id: string | null;
  accepted_at: string | null;
}

// Must be called inside a tenant transaction. The student, the acceptance
// and the event are written in it together.
@Injectable()
export class AdmissionsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly outbox: Outbox,
    private readonly events: EventStatus,
  ) {}

  async list(): Promise<Application[]> {
    const { rows } = await this.tenantDb.db.execute<ApplicationRow>(sql`
      select id, applicant_name, status, student_id,
             ${utc(sql`accepted_at`)} as accepted_at
        from admission_applications
       order by id`);
    return rows.map((row) => ({
      id: row.id,
      applicantName: row.applicant_name,
      status: row.status,
      studentId: row.student_id,
      acceptedAt: row.accepted_at,
    }));
  }

  async eventOf(applicationId: string): Promise<EventStatusView> {
    const found = await this.tenantDb.db.execute<{ status: string }>(
      sql`select status from admission_applications where id = ${applicationId}`,
    );
    // Another school's application is not visible here, so it is not found.
    if (!found.rows[0]) throw new NotFoundException('Application not found');
    const event = await this.events.find(
      'student.accepted',
      'applicationId',
      applicationId,
    );
    // A pending application has caused nothing yet.
    if (!event) throw new NotFoundException('No event for this application');
    return event;
  }

  async accept(applicationId: string): Promise<Acceptance> {
    const db = this.tenantDb.db;
    // The row lock makes a second accept of the same application wait here
    // until the first one commits, and then see that it is accepted.
    const found = await db.execute<{ applicant_name: string; status: string }>(
      sql`select applicant_name, status from admission_applications
           where id = ${applicationId} for update`,
    );
    const application = found.rows[0];
    if (!application) throw new NotFoundException('Application not found');
    if (application.status !== 'pending') {
      throw new ConflictException({
        statusCode: 409,
        code: 'ALREADY_ACCEPTED',
        message: 'Application already accepted',
      });
    }

    const [student] = await db
      .insert(students)
      .values({ fullName: application.applicant_name })
      .returning({ id: students.id });
    const accepted = await db.execute<{ accepted_at: string }>(sql`
      update admission_applications
         set status = 'accepted',
             student_id = ${student.id},
             accepted_at = now(),
             accepted_by = NULLIF(current_setting('app.user_id', true), '')::uuid
       where id = ${applicationId}
       returning to_char(accepted_at at time zone 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as accepted_at`);

    await this.outbox.emit('student.accepted', {
      applicationId,
      studentId: student.id,
      acceptedAt: accepted.rows[0].accepted_at,
    });
    return { applicationId, studentId: student.id };
  }
}
