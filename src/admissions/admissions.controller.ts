import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { isUuid } from '../common/uuid.js';
import { RequiresPermission } from '../entitlements/decorators.js';
import { AdmissionsService } from './admissions.service.js';

@Controller('schools/:schoolId/admissions/applications')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get()
  @RequiresPermission('admissions:read')
  list() {
    return this.admissions.list();
  }

  // What became of the event the acceptance wrote.
  @Get(':applicationId/event')
  @RequiresPermission('admissions:read')
  event(@Param('applicationId') applicationId: string) {
    if (!isUuid(applicationId)) {
      throw new BadRequestException('Invalid application id');
    }
    return this.admissions.eventOf(applicationId);
  }

  @Post(':applicationId/accept')
  @RequiresPermission('admissions:accept')
  accept(@Param('applicationId') applicationId: string) {
    if (!isUuid(applicationId)) {
      throw new BadRequestException('Invalid application id');
    }
    return this.admissions.accept(applicationId);
  }
}
