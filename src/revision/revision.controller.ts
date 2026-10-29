import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RevisionService } from './revision.service.js';

/** No class-level AuthGuard: each handler checks its role itself. */
@Controller()
export class RevisionController {
  constructor(private readonly revisionService: RevisionService) {}

  @Post('student/flashcards')
  async createFlashcard(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.revisionService.createFlashcard(request));
  }

  @Get('student/flashcards')
  async listFlashcards(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.revisionService.listFlashcards(request));
  }

  @Post('student/flashcards/:id/review')
  async reviewFlashcard(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.revisionService.reviewFlashcard(id, request));
  }

  @Get('student/revision/today')
  async revisionToday(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.revisionService.revisionToday(request));
  }

  @Get('student/revision')
  async revisionOverview(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.revisionService.revisionOverview(request));
  }

  @Post('student/bookmarks')
  async createBookmark(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.revisionService.createBookmark(request));
  }

  @Get('student/bookmarks')
  async listBookmarks(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.revisionService.listBookmarks(request));
  }

  @Delete('student/bookmarks/:id')
  async deleteBookmark(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.revisionService.deleteBookmark(id, request));
  }

  @Post('student/notes')
  async createNote(@Req() request: Request, @Res() response: Response) {
    return response
      .status(201)
      .json(await this.revisionService.createNote(request));
  }

  @Get('student/notes')
  async listNotes(@Req() request: Request, @Res() response: Response) {
    return response
      .status(200)
      .json(await this.revisionService.listNotes(request));
  }

  @Patch('student/notes/:id')
  async updateNote(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.revisionService.updateNote(id, request));
  }

  @Delete('student/notes/:id')
  async deleteNote(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.revisionService.deleteNote(id, request));
  }
}
