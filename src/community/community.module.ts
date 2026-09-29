import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommunityController } from './community.controller.js';
import { CommunityService } from './community.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CommunityController],
  providers: [CommunityService],
})
export class CommunityModule {}
