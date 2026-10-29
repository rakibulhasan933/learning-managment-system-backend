import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AnalyticsService } from './analytics.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';

@Controller('admin/analytics')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('funnel')
  async funnel(@Res() response: Response) {
    return response
      .status(200)
      .json(await this.analyticsService.funnel());
  }

  @Get('cohorts')
  async cohorts(@Res() response: Response) {
    return response
      .status(200)
      .json(await this.analyticsService.cohorts());
  }

  @Get('refund-reasons')
  async refundReasons(@Res() response: Response) {
    return response
      .status(200)
      .json(await this.analyticsService.refundReasons());
  }

  @Get('teachers')
  async teachers(@Res() response: Response) {
    return response
      .status(200)
      .json(await this.analyticsService.teachers());
  }

  @Get(':report/export')
  async export(
    @Param('report') report: string,
    @Res() response: Response,
  ) {
    const { csv, filename } =
      await this.analyticsService.exportReport(report);
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    return response.status(200).send(csv);
  }
}
