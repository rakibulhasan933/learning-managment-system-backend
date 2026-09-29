import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { UploadsService } from './uploads.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('uploads')
@UseGuards(AuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('image')
  async image(@Req() request: Request, @Res() response: Response) {
    return response.status(201).json(await this.uploadsService.image(request));
  }
}
