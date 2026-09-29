import { Controller, Param, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ProgressService } from './progress.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('progress')
@UseGuards(AuthGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Put('lectures/:lectureId')
  async lecture(
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.progressService.lecture(lectureId, request));
  }

  @Put('videos/:videoId')
  async video(
    @Param('videoId') videoId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.progressService.video(videoId, request));
  }
}
