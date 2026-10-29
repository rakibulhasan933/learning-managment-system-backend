import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CertificatesService } from './certificates.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  // Public: no AuthGuard here, so anyone can verify a printed code.
  @Get('verify')
  async verify(
    @Query('code') code: string,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.certificatesService.verify(code ?? ''));
  }

  @Get()
  @UseGuards(AuthGuard)
  async list(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.certificatesService.list(request));
  }

  @Get(':certificateId/download-url')
  @UseGuards(AuthGuard)
  async downloadUrl(
    @Param('certificateId') certificateId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.certificatesService.downloadUrl(certificateId, request));
  }

  @Get(':certificateId/download')
  @UseGuards(AuthGuard)
  async download(
    @Param('certificateId') certificateId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response.redirect(
      await this.certificatesService.download(certificateId, request),
    );
  }
}
