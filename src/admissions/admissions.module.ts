import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { EventsModule } from '../events/events.module.js';
import { AdmissionsController } from './admissions.controller.js';
import { AdmissionsService } from './admissions.service.js';

@Module({
  imports: [DbModule, EventsModule],
  controllers: [AdmissionsController],
  providers: [AdmissionsService],
})
export class AdmissionsModule {}
