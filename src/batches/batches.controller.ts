import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { BatchesService } from './batches.service.js';

/** No class-level AuthGuard: each handler checks its role itself. */
@Controller()
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Post('instructor/batches')
  async create(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.batchesService.createBatch(request));
  }

  @Get('instructor/batches')
  async list(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.batchesService.listBatches(request));
  }

  @Get('instructor/batches/:id')
  async get(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.batchesService.getBatch(id, request));
  }

  @Post('batches/:id/join')
  async join(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.batchesService.joinBatch(id, request));
  }

  @Post('instructor/batches/:id/members')
  async addMember(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.batchesService.addMember(id, request));
  }

  @Post('instructor/batches/:id/drip')
  async drip(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.batchesService.createDrip(id, request));
  }

  @Get('batches/:id/drip-status')
  async dripStatus(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.batchesService.dripStatus(id, request));
  }

  @Post('instructor/batches/:id/deadlines')
  async deadline(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.batchesService.createDeadline(id, request));
  }

  @Get('batches/:id/leaderboard')
  async leaderboard(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.batchesService.leaderboard(id, request));
  }

  @Post('instructor/batches/:id/announcements')
  async announcement(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.batchesService.createAnnouncement(id, request));
  }
}
