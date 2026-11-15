import { BadRequestException, Controller, Param, Post } from '@nestjs/common';
import { isUuid } from '../common/uuid.js';
import { RequiresPermission } from '../entitlements/decorators.js';
import { AdmissionsService } from './admissions.service.js';

@Controller('schools/:schoolId/admissions/applications')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Post(':applicationId/accept')
  @RequiresPermission('admissions:accept')
  accept(@Param('applicationId') applicationId: string) {
    if (!isUuid(applicationId)) {
      throw new BadRequestException('Invalid application id');
    }
    return this.admissions.accept(applicationId);
  }
}
