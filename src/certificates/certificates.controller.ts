import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CertificatesService } from './certificates.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('certificates')
@UseGuards(AuthGuard)
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Get()
  async list(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.certificatesService.list(request));
  }

  @Get(':certificateId/download-url')
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
