import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { MeController } from './me.controller.js';
import { StudentsController } from './students.controller.js';

@Module({
  imports: [DbModule],
  controllers: [StudentsController, MeController],
})
export class CoreModule {}
