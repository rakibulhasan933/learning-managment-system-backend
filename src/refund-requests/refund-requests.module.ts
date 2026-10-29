import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RefundRequestsController } from './refund-requests.controller.js';
import { RefundRequestsService } from './refund-requests.service.js';

@Module({
  controllers: [RefundRequestsController],
  imports: [AuthModule],
  providers: [RefundRequestsService],
})
export class RefundRequestsModule {}
