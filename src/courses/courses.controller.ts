import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CoursesService } from './courses.service.js';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  async list(@Query() query: unknown, @Res() response: Response) {
    return response.status(200).json(await this.coursesService.list(query));
  }

  @Get(':slug/enrollment-status')
  async enrollmentStatus(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.coursesService.enrollmentStatus(slug, request));
  }

  @Get(':slug')
  async detail(@Param('slug') slug: string, @Res() response: Response) {
    return response.status(200).json(await this.coursesService.detail(slug));
  }
}
