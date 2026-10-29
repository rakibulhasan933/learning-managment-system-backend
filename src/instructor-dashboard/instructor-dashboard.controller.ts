import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InstructorDashboardService } from './instructor-dashboard.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';

@Controller('instructor')
@UseGuards(AuthGuard, RolesGuard)
@Roles('instructor', 'admin')
export class InstructorDashboardController {
  constructor(
    private readonly instructorDashboardService: InstructorDashboardService,
  ) {}

  @Get('overview')
  async overview(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.instructorDashboardService.overview(request));
  }

  @Get('notifications')
  async notifications(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.instructorDashboardService.notifications(request));
  }

  @Post('notifications/:notificationId/read')
  async markNotificationRead(
    @Param('notificationId') notificationId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.instructorDashboardService.markNotificationRead(
      notificationId,
      request,
    );
    return response.status(204).send();
  }

  @Get('courses/:courseId/quiz-results')
  async quizResults(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorDashboardService.quizResults(courseId, request),
      );
  }

  @Get('courses/:courseId/discussions')
  async discussions(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorDashboardService.discussions(courseId, request),
      );
  }

  @Post('courses/:courseId/discussions')
  async createDiscussion(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(
        await this.instructorDashboardService.createDiscussion(
          courseId,
          request,
        ),
      );
  }

  @Post('courses/:courseId/announcements')
  async createAnnouncement(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(
        await this.instructorDashboardService.createAnnouncement(
          courseId,
          request,
        ),
      );
  }

  @Get('seller-dashboard')
  async sellerDashboard(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.instructorDashboardService.sellerDashboard(request));
  }

  @Get('seller-dashboard/export')
  async sellerDashboardExport(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const csv =
      await this.instructorDashboardService.sellerDashboardExport(request);
    return response
      .status(200)
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header(
        'Content-Disposition',
        'attachment; filename="seller-students.csv"',
      )
      .send(csv);
  }

  @Post('seller-dashboard/announcement-draft')
  async sellerAnnouncementDraft(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorDashboardService.sellerAnnouncementDraft(request),
      );
  }

  @Get('payouts')
  async payouts(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.instructorDashboardService.payouts(request));
  }

  @Post('payouts')
  async requestPayout(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.instructorDashboardService.requestPayout(request));
  }

  @Get('courses/:courseId/students')
  async students(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.instructorDashboardService.students(courseId, request));
  }
}
