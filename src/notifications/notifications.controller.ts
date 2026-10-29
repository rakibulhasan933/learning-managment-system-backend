import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { NotificationsService } from './notifications.service.js';

/**
 * Notification center for every authenticated role. Reads the existing
 * notifications table — no migration needed. This is a different path
 * from the legacy GET /instructor/notifications endpoint, which is left
 * untouched.
 */
@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('notifications')
  async list(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.notificationsService.list(request));
  }

  @Get('notifications/unread-count')
  async unreadCount(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.notificationsService.unreadCount(request));
  }

  @Post('notifications/read-all')
  async markAllRead(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.notificationsService.markAllRead(request));
  }

  @Post('notifications/:id/read')
  async markRead(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.notificationsService.markRead(id, request));
  }
}
