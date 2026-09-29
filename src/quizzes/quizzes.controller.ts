import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { QuizzesService } from './quizzes.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('quizzes')
@UseGuards(AuthGuard)
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Get('target')
  async target(
    @Query() query: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.quizzesService.target(query, request));
  }

  @Get(':quizId')
  async detail(
    @Param('quizId') quizId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.quizzesService.detail(quizId, request));
  }

  @Post(':quizId/submit')
  async submit(
    @Param('quizId') quizId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.quizzesService.submit(quizId, request));
  }
}
