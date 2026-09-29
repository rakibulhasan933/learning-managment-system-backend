import { Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AssignmentsService } from './assignments.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';

@Controller('assignments')
@UseGuards(AuthGuard)
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Post(':assignmentId/submit')
  async submit(
    @Param('assignmentId') assignmentId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.assignmentsService.submit(assignmentId, request));
  }
}
