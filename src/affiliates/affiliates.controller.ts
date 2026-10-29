import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AffiliatesService } from './affiliates.service.js';

/** No class-level AuthGuard: each handler checks its role itself. */
@Controller()
export class AffiliatesController {
  constructor(private readonly affiliatesService: AffiliatesService) {}

  @Post('affiliate/links')
  async createLink(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.affiliatesService.createLink(request));
  }

  @Get('affiliate/links')
  async listLinks(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.affiliatesService.listLinks(request));
  }

  @Post('affiliate/track')
  async track(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.affiliatesService.track(request));
  }

  @Post('affiliate/attribute')
  async attribute(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.affiliatesService.attribute(request));
  }

  @Get('affiliate/dashboard')
  async dashboard(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.affiliatesService.dashboard(request));
  }

  @Post('affiliate/payouts')
  async requestPayout(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.affiliatesService.requestPayout(request));
  }

  @Get('affiliate/payouts')
  async listPayouts(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.affiliatesService.listPayouts(request));
  }

  @Post('admin/affiliate/payouts/:id/approve')
  async approve(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.affiliatesService.adminPayoutAction(id, 'approve', request),
      );
  }

  @Post('admin/affiliate/payouts/:id/reject')
  async reject(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.affiliatesService.adminPayoutAction(id, 'reject', request),
      );
  }

  @Post('admin/affiliate/payouts/:id/mark-paid')
  async markPaid(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.affiliatesService.adminPayoutAction(
          id,
          'mark-paid',
          request,
        ),
      );
  }
}
