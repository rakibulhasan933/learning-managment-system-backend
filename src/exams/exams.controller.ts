import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ExamsService } from './exams.service.js';

/** No class-level AuthGuard: each handler checks its role itself. */
@Controller()
export class ExamsController {
  constructor(private readonly examsService: ExamsService) {}

  @Post('instructor/question-bank/import')
  async importQuestions(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.examsService.importQuestions(request));
  }

  @Get('instructor/question-bank')
  async listQuestions(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.examsService.listQuestions(request));
  }

  @Post('instructor/question-bank/:questionId/attach')
  async attachQuestion(
    @Param('questionId') questionId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.examsService.attachQuestion(questionId, request));
  }

  @Post('model-tests')
  async createModelTest(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.examsService.createModelTest(request));
  }

  @Get('model-tests/:id')
  async getModelTest(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.examsService.getModelTest(id, request));
  }

  @Post('model-tests/:id/attempts')
  async startAttempt(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.examsService.startAttempt(id, request));
  }

  @Post('model-tests/:id/attempts/:attemptId/submit')
  async submitAttempt(
    @Param('id') id: string,
    @Param('attemptId') attemptId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.examsService.submitAttempt(id, attemptId, request));
  }

  @Get('model-tests/:id/leaderboard')
  async leaderboard(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.examsService.leaderboard(id, request));
  }

  @Get('model-tests/:id/topic-report')
  async topicReport(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.examsService.topicReport(id, request));
  }

  @Get('student/mistake-bank')
  async mistakeBank(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.examsService.mistakeBank(request));
  }
}
