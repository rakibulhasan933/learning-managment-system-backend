import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { LecturesService } from './lectures.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('lectures')
@UseGuards(AuthGuard)
export class LecturesController {
  constructor(private readonly lecturesService: LecturesService) {}

  @Get(':id/video-url')
  async lectureVideo(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.lecturesService.lectureVideo(id, request));
  }

  @Get('videos/:id/video-url')
  async video(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.lecturesService.video(id, request));
  }
}
