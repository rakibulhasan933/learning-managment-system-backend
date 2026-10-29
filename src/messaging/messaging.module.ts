import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MessagingController } from './messaging.controller.js';
import { MessagingService } from './messaging.service.js';

@Module({
  controllers: [MessagingController],
  imports: [AuthModule],
  providers: [MessagingService],
})
export class MessagingModule {}
