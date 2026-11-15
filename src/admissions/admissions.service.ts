import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { students } from '../core/core.schema.js';
import { TenantDb } from '../db/tenant-db.js';
import { Outbox } from '../events/outbox.js';

export interface Acceptance {
  applicationId: string;
  studentId: string;
}

// Must be called inside a tenant transaction. The student, the acceptance
// and the event are written in it together.
@Injectable()
export class AdmissionsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly outbox: Outbox,
  ) {}

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
