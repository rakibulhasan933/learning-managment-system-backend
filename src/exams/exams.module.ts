import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ExamsController } from './exams.controller.js';
import { ExamsService } from './exams.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ExamsController],
  providers: [ExamsService],
})
export class ExamsModule {}
