import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LecturesController } from './lectures.controller.js';
import { LecturesService } from './lectures.service.js';

@Module({
  imports: [AuthModule],
  controllers: [LecturesController],
  providers: [LecturesService],
})
export class LecturesModule {}
