import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  controllers: [AnalyticsController],
  imports: [AuthModule],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
