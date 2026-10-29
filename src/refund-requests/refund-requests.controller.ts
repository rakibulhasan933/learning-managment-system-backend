import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RefundRequestsService } from './refund-requests.service.js';

/**
 * Student refund requests against the existing refunds table (the admin
 * approve/reject/process flow stays the single decision point). No
 * class-level AuthGuard: each handler checks its role itself.
 */
@Controller()
export class RefundRequestsController {
  constructor(
    private readonly refundRequestsService: RefundRequestsService,
  ) {}

  @Post('refund-requests')
  async create(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.refundRequestsService.createRequest(request));
  }

  @Get('refund-requests')
  async listMine(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.refundRequestsService.listMine(request));
  }

  @Get('instructor/refund-requests')
  async listForInstructor(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.refundRequestsService.listForInstructor(request));
  }
}
