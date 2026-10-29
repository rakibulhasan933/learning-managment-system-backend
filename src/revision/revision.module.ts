import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RevisionController } from './revision.controller.js';
import { RevisionService } from './revision.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RevisionController],
  providers: [RevisionService],
})
export class RevisionModule {}
