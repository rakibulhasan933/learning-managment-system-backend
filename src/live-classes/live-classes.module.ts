import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LiveClassesController } from './live-classes.controller.js';
import { LiveClassesService } from './live-classes.service.js';

@Module({
  imports: [AuthModule],
  controllers: [LiveClassesController],
  providers: [LiveClassesService],
})
export class LiveClassesModule {}
