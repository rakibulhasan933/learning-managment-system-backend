import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { LearningService } from './learning.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('learning')
@UseGuards(AuthGuard)
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  @Get('courses/:courseId')
  async course(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.learningService.course(courseId, request));
  }
}
