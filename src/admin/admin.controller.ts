import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminOverview } from './admin-overview/admin-overview.js';
import { AdminCourses } from './admin-courses/admin-courses.js';
import { AdminSettings } from './admin-settings/admin-settings.js';
import { AdminUsers } from './admin-users/admin-users.js';
import { AdminFinance } from './admin-finance/admin-finance.js';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminOverview: AdminOverview,
    private readonly adminCourses: AdminCourses,
    private readonly adminSettings: AdminSettings,
    private readonly adminUsers: AdminUsers,
    private readonly adminFinance: AdminFinance,
  ) {}

  @Get('health')
  async health(@Req() request: Request, @Res() response: Response) {
    return response.status(200).json(await this.adminOverview.health(request));
  }

  @Get('reports/:report')
  async report(
    @Param('report') report: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.adminOverview.report(report, request));
  }

  @Get('revenue')
  async revenue(@Req() request: Request, @Res() response: Response) {
    return response.status(200).json(await this.adminOverview.revenue(request));
  }

  @Get('categories')
  async categories(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.adminCourses.listCategories(request));
  }

  @Post('categories')
  async createCategory(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.adminCourses.createCategory(request));
  }

  @Patch('categories/:id')
  async updateCategory(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.adminCourses.updateCategory(id, request));
  }

  @Delete('categories/:id')
  async deleteCategory(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.adminCourses.deleteCategory(id, request);
    return response.status(204).send();
  }

  @Get('settings')
  async settings(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.adminSettings.settings(request));
  }
  @Put('settings')
  async updateSettings(@Req() request: Request, @Res() response: Response) {
    await this.adminSettings.updateSettings(request);
    return response.status(204).send();
  }
  @Post('announcements')
  async announce(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.adminSettings.announce(request));
  }
  @Get('audit-logs')
  async audit(@Req() request: Request, @Res() response: Response) {
    return response.status(200).json(await this.adminSettings.audit(request));
  }

  @Get('users')
  async users(@Req() request: Request, @Res() response: Response) {
    return response.status(200).json(await this.adminUsers.list(request));
  }

  @Get('enrollments')
  async enrollments(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.adminUsers.enrollments(request));
  }

  @Patch('enrollments/:id/:action')
  async enrollmentStatus(
    @Param('id') id: string,
    @Param('action') action: 'activate' | 'revoke',
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.adminUsers.setEnrollmentStatus(id, action, request);
    return response.status(204).send();
  }

  @Post('users/instructors')
  async createInstructor(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.adminUsers.createInstructor(request));
  }

  @Post('users/:id/suspend')
  async suspendUser(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.adminUsers.setSuspended(id, 'suspend', request);
    return response.status(204).send();
  }

  @Post('users/:id/activate')
  async activateUser(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.adminUsers.setSuspended(id, 'activate', request);
    return response.status(204).send();
  }

  @Get('courses/pending')
  async pendingCourses(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.adminCourses.listPending(request));
  }

  @Post('courses/:id/approve')
  async approveCourse(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.adminCourses.setApproval(id, 'approve', request);
    return response.status(204).send();
  }

  @Post('courses/:id/reject')
  async rejectCourse(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.adminCourses.setApproval(id, 'reject', request);
    return response.status(204).send();
  }

  @Get('payouts')
  async payouts(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.adminFinance.listPayouts(request));
  }

  @Post('payouts/:id/approve')
  async approvePayout(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.adminFinance.decidePayout(id, 'approve', request);
    return response.status(204).send();
  }

  @Post('payouts/:id/reject')
  async rejectPayout(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.adminFinance.decidePayout(id, 'reject', request);
    return response.status(204).send();
  }

  @Post('payouts/:id/paid')
  async markPayoutPaid(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.adminFinance.decidePayout(id, 'paid', request);
    return response.status(204).send();
  }

  @Get('refunds')
  async refunds(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.adminFinance.listRefunds(request));
  }

  @Post('refunds')
  async createRefund(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.adminFinance.createRefund(request));
  }

  @Post('refunds/:id/:action')
  async decideRefund(
    @Param('id') id: string,
    @Param('action') action: 'approve' | 'reject' | 'process',
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.adminFinance.decideRefund(id, action, request);
    return response.status(204).send();
  }
}
