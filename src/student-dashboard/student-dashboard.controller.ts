import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { StudentDashboardService } from './student-dashboard.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('student')
@UseGuards(AuthGuard)
export class StudentDashboardController {
  constructor(
    private readonly studentDashboardService: StudentDashboardService,
  ) {}

  @Get('analytics')
  async getAnalytics(@Req() request: Request, @Res() response: Response) {
    try {
      const result = await this.studentDashboardService.getAnalytics(request);
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpException) {
        response.status(error.getStatus()).json(error.getResponse());
        return;
      }
      response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ message: 'Internal server error.' });
    }
  }
}
