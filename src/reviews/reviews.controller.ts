import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReviewsService } from './reviews.service.js';

/**
 * Course reviews. No class-level AuthGuard: GET /courses/:courseId/reviews
 * is public, and every other handler checks its role itself (same pattern
 * as SalesController / ExamsController).
 */
@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('courses/:courseId/reviews/mine')
  async mine(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.reviewsService.getMine(courseId, request));
  }

  @Get('courses/:courseId/reviews')
  async list(@Param('courseId') courseId: string, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.reviewsService.listPublic(courseId));
  }

  @Post('courses/:courseId/reviews')
  async create(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.reviewsService.createReview(courseId, request));
  }

  @Patch('courses/:courseId/reviews')
  async update(
    @Param('courseId') courseId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.reviewsService.updateReview(courseId, request));
  }

  @Post('reviews/:id/replies')
  async reply(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.reviewsService.replyToReview(id, request));
  }

  @Post('reviews/:id/visibility')
  async visibility(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.reviewsService.setVisibility(id, request));
  }
}
