import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { LiveClassesService } from './live-classes.service.js';

/** No class-level AuthGuard: each handler checks its role itself. */
@Controller()
export class LiveClassesController {
  constructor(private readonly liveClassesService: LiveClassesService) {}

  @Post('instructor/live-classes')
  async create(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.liveClassesService.createLiveClass(request));
  }

  @Get('instructor/live-classes')
  async listInstructor(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.liveClassesService.listInstructorLiveClasses(request));
  }

  @Get('student/live-classes')
  async listStudent(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.liveClassesService.listStudentLiveClasses(request));
  }

  @Post('instructor/live-classes/:id/recording')
  async recording(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.liveClassesService.setRecording(id, request));
  }

  @Post('instructor/live-classes/:id/attendance')
  async markAttendance(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.liveClassesService.markAttendance(id, request));
  }

  @Get('instructor/live-classes/:id/attendance')
  async listAttendance(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.liveClassesService.listAttendance(id, request));
  }
}
