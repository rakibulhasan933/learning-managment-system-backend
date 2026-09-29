import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InstructorDashboardController } from './instructor-dashboard.controller.js';
import { InstructorDashboardService } from './instructor-dashboard.service.js';

@Module({
  imports: [AuthModule],
  controllers: [InstructorDashboardController],
  providers: [InstructorDashboardService],
})
export class InstructorDashboardModule {}
