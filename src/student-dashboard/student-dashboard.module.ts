import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StudentDashboardController } from './student-dashboard.controller.js';
import { StudentDashboardService } from './student-dashboard.service.js';

@Module({
  imports: [AuthModule],
  controllers: [StudentDashboardController],
  providers: [StudentDashboardService],
})
export class StudentDashboardModule {}
