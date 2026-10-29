import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SalesService } from './sales.service.js';

/**
 * Contract routes for bundles / subscriptions / instalments / order
 * bumps / abandoned carts. No class-level AuthGuard: GET /bundles is
 * public, and every other handler checks its role itself (same pattern
 * as PaymentsService.requirePaymentUser).
 */
@Controller()
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get('bundles')
  async listBundles(@Res() response: Response) {
    return response
      .status(200)
      .json(await this.salesService.listBundles());
  }

  @Post('bundles')
  async createBundle(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.salesService.createBundle(request));
  }

  @Post('orders/bundle')
  async createBundleOrder(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.salesService.createBundleOrder(request));
  }

  @Post('subscriptions')
  async createSubscription(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.salesService.createSubscription(request));
  }

  @Post('orders/:orderId/instalments')
  async defineInstalments(
    @Param('orderId') orderId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.salesService.defineInstalments(orderId, request));
  }

  @Get('orders/:orderId/instalments')
  async getInstalments(
    @Param('orderId') orderId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.salesService.getInstalments(orderId, request));
  }

  @Post('orders/:orderId/instalments/:instalmentId/pay')
  async payInstalment(
    @Param('orderId') orderId: string,
    @Param('instalmentId') instalmentId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.salesService.payInstalment(orderId, instalmentId, request),
      );
  }

  @Post('checkout/order-bump')
  async addOrderBump(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.salesService.addOrderBump(request));
  }

  @Post('carts/abandoned')
  async recordAbandoned(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.salesService.recordAbandonedCart(request));
  }

  @Get('instructor/abandoned-carts')
  async teacherAbandonedCarts(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.salesService.teacherAbandonedCarts(request));
  }

  @Get('orders/:orderId/refund-estimate')
  async refundEstimate(
    @Param('orderId') orderId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.salesService.refundEstimate(orderId, request));
  }
}
