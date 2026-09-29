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
import { PaymentsService } from './payments.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('payments')
@UseGuards(AuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('my-orders')
  async myOrders(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.paymentsService.myOrders(request));
  }

  @Post('coupons/preview')
  async previewCoupon(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.paymentsService.couponPreview(request));
  }

  @Post('instructions')
  async instructions(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.paymentsService.createInstructions(request));
  }

  @Get('orders/:orderId/instructions')
  async orderInstructions(
    @Param('orderId') orderId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.paymentsService.orderInstructions(orderId, request));
  }

  @Post('orders/:orderId/proof')
  async submitProof(
    @Param('orderId') orderId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.paymentsService.submitProof(orderId, request));
  }
}
