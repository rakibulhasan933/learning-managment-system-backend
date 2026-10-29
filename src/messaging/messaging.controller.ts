import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MessagingService } from './messaging.service.js';

/**
 * Instructor <-> student messaging. Text-only (max 2000 chars), threads
 * are scoped to a course and the two parties. Requires the
 * message_threads/messages tables (migration), otherwise 503.
 * No class-level AuthGuard: each handler checks its role itself.
 */
@Controller()
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get('messages/threads')
  async listThreads(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.messagingService.listThreads(request));
  }

  @Get('messages/threads/:id')
  async getThread(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.messagingService.getThread(id, request));
  }

  @Post('messages/threads')
  async createThread(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.messagingService.createThread(request));
  }

  @Post('messages/threads/:id/messages')
  async postMessage(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.messagingService.postMessage(id, request));
  }

  @Post('instructor/messages/broadcast')
  async broadcast(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.messagingService.broadcast(request));
  }
}
