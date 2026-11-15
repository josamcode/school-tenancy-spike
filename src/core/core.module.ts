import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { StudentsController } from './students.controller.js';

@Module({
  imports: [DbModule],
  controllers: [StudentsController],
})
export class CoreModule {}
