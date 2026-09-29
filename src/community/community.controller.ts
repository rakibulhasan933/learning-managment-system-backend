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

import { CommunityService } from './community.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('community')
@UseGuards(AuthGuard)
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Get('courses/:courseId/discussions')
  async list(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.communityService.list(courseId, request));
  }

  @Post('courses/:courseId/discussions')
  async create(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.communityService.create(courseId, request));
  }
}
