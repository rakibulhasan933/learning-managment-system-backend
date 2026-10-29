import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AffiliatesController } from './affiliates.controller.js';
import { AffiliatesService } from './affiliates.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AffiliatesController],
  providers: [AffiliatesService],
})
export class AffiliatesModule {}
