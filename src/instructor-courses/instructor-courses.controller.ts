import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InstructorCoursesService } from './instructor-courses.service.js';
import { CourseCrud } from './course-crud/course-crud.js';
import { CourseOutline } from './course-outline/course-outline.js';
import { CourseContent } from './course-content/course-content.js';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';

@Controller('instructor/courses')
@UseGuards(AuthGuard, RolesGuard)
@Roles('instructor', 'admin')
export class InstructorCoursesController {
  constructor(
    private readonly instructorCoursesService: InstructorCoursesService,
    private readonly courseCrud: CourseCrud,
    private readonly courseOutline: CourseOutline,
    private readonly courseContent: CourseContent,
  ) {}

  @Get()
  async list(@Req() request: Request, @Res() response: Response) {
    return response.status(200).json(await this.courseCrud.list(request));
  }

  @Post()
  async create(@Req() request: Request, @Res() response: Response) {
    return response.status(201).json(await this.courseCrud.create(request));
  }

  @Get(':id')
  async detail(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response.status(200).json(await this.courseCrud.detail(id, request));
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response.status(200).json(await this.courseCrud.update(id, request));
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.courseCrud.remove(id, request);
    return response.status(204).send();
  }

  @Get(':id/milestones')
  async milestones(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.courseOutline.milestones(id, request));
  }

  @Post(':id/modules/:moduleId/videos')
  async createVideo(
    @Param('moduleId') moduleId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.courseContent.createVideo(moduleId, request));
  }

  @Patch(':id/videos/:videoId')
  async updateVideo(
    @Param('videoId') videoId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.courseContent.updateVideo(videoId, request));
  }

  @Delete(':id/videos/:videoId')
  async deleteVideo(
    @Param('videoId') videoId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.courseContent.deleteVideo(videoId, request);
    return response.status(204).send();
  }

  @Post(':id/videos/:videoId/material')
  async uploadMaterial(
    @Param('id') id: string,
    @Param('videoId') videoId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.courseContent.uploadMaterial(id, videoId, request));
  }

  @Post(':id/videos/:videoId/material-upload')
  async uploadMaterialBuffer(
    @Param('id') id: string,
    @Param('videoId') videoId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const fileName = String(request.query.fileName ?? 'material');
    const kind = request.query.kind === 'slides' ? 'slides' : 'pdf';
    return response
      .status(201)
      .json(
        await this.courseContent.uploadMaterialBuffer(
          id,
          videoId,
          fileName,
          kind,
          request,
        ),
      );
  }

  @Post(':id/modules/:moduleId/material')
  async uploadModuleMaterial(
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(
        await this.courseContent.uploadModuleMaterial(id, moduleId, request),
      );
  }

  @Post(':id/modules/:moduleId/material-upload')
  async uploadModuleMaterialBuffer(
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(
        await this.courseContent.uploadModuleMaterialBuffer(
          id,
          moduleId,
          String(request.query.fileName ?? 'material'),
          request,
        ),
      );
  }

  @Delete(':id/modules/:moduleId/material')
  async deleteModuleMaterial(
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.courseContent.deleteModuleMaterial(id, moduleId, request);
    return response.status(204).send();
  }

  @Post(':id/videos/:videoId/video-upload-url')
  async videoUploadUrl(
    @Param('id') id: string,
    @Param('videoId') videoId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(
        await this.courseContent.createVideoUploadUrl(id, videoId, request),
      );
  }

  @Post(':id/videos/:videoId/video-upload')
  async videoUpload(
    @Param('id') id: string,
    @Param('videoId') videoId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(
        await this.courseContent.uploadVideo(
          id,
          videoId,
          String(request.query.fileName ?? 'video.mp4'),
          request,
        ),
      );
  }

  @Post(':id/milestones/:milestoneId/modules')
  async createModule(
    @Param('milestoneId') milestoneId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.courseOutline.createModule(milestoneId, request));
  }

  @Patch(':id/modules/:moduleId')
  async updateModule(
    @Param('moduleId') moduleId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.courseOutline.updateModule(moduleId, request));
  }

  @Delete(':id/modules/:moduleId')
  async deleteModule(
    @Param('moduleId') moduleId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.courseOutline.deleteModule(moduleId, request);
    return response.status(204).send();
  }

  @Get(':id/outline')
  async outline(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(await this.instructorCoursesService.outline(id, request));
  }
  @Post(':id/sections')
  async createSection(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(await this.instructorCoursesService.createSection(id, request));
  }
  @Patch(':id/sections/:sectionId')
  async updateSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorCoursesService.updateSection(
          id,
          sectionId,
          request,
        ),
      );
  }
  @Delete(':id/sections/:sectionId')
  async deleteSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.instructorCoursesService.deleteSection(id, sectionId, request);
    return response.status(204).send();
  }
  @Post(':id/sections/:sectionId/lectures')
  async createLecture(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(
        await this.instructorCoursesService.createLecture(
          id,
          sectionId,
          request,
        ),
      );
  }
  @Patch(':id/lectures/:lectureId')
  async updateLecture(
    @Param('id') id: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorCoursesService.updateLecture(
          id,
          lectureId,
          request,
        ),
      );
  }
  @Delete(':id/lectures/:lectureId')
  async deleteLecture(
    @Param('id') id: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.instructorCoursesService.deleteLecture(id, lectureId, request);
    return response.status(204).send();
  }
  @Put(':id/sections/:sectionId/quiz')
  async sectionQuiz(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorCoursesService.saveSectionQuiz(
          id,
          sectionId,
          request,
        ),
      );
  }
  @Put(':id/lectures/:lectureId/quiz')
  async lectureQuiz(
    @Param('id') id: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorCoursesService.saveLectureQuiz(
          id,
          lectureId,
          request,
        ),
      );
  }
  @Put(':id/modules/:moduleId/quiz')
  async moduleQuiz(
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorCoursesService.saveModuleQuiz(
          id,
          moduleId,
          request,
        ),
      );
  }
  @Delete(':id/quizzes/:quizId')
  async deleteQuiz(
    @Param('id') id: string,
    @Param('quizId') quizId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.instructorCoursesService.deleteQuiz(id, quizId, request);
    return response.status(204).send();
  }
  @Put(':id/sections/:sectionId/assignment')
  async sectionAssignment(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorCoursesService.saveSectionAssignment(
          id,
          sectionId,
          request,
        ),
      );
  }
  @Put(':id/lectures/:lectureId/assignment')
  async lectureAssignment(
    @Param('id') id: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorCoursesService.saveLectureAssignment(
          id,
          lectureId,
          request,
        ),
      );
  }
  @Put(':id/modules/:moduleId/assignment')
  async moduleAssignment(
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(200)
      .json(
        await this.instructorCoursesService.saveModuleAssignment(
          id,
          moduleId,
          request,
        ),
      );
  }
  @Delete(':id/assignments/:assignmentId')
  async deleteAssignment(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.instructorCoursesService.deleteAssignment(
      id,
      assignmentId,
      request,
    );
    return response.status(204).send();
  }

  @Post(':id/lectures/:lectureId/video-upload')
  async lectureVideoUpload(
    @Param('id') id: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(
        await this.courseContent.uploadLectureVideo(
          id,
          lectureId,
          String(request.query.fileName ?? 'video.mp4'),
          request,
        ),
      );
  }
  @Post(':id/lectures/:lectureId/video-upload-url')
  async lectureVideoUploadUrl(
    @Param('id') id: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(
        await this.courseContent.createLectureVideoUploadUrl(
          id,
          lectureId,
          request,
        ),
      );
  }
  @Post(':id/lectures/:lectureId/material')
  async lectureMaterial(
    @Param('id') id: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return response
      .status(201)
      .json(
        await this.courseContent.uploadLectureMaterialBase64(
          id,
          lectureId,
          request,
        ),
      );
  }
  @Post(':id/lectures/:lectureId/material-upload')
  async lectureMaterialUpload(
    @Param('id') id: string,
    @Param('lectureId') lectureId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const kind = request.query.kind === 'slides' ? 'slides' : 'pdf';
    return response
      .status(201)
      .json(
        await this.courseContent.uploadLectureMaterialBuffer(
          id,
          lectureId,
          String(request.query.fileName ?? 'material'),
          kind,
          request,
        ),
      );
  }
  @Patch(':id/assignment-submissions/:submissionId/grade')
  async gradeAssignment(
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.instructorCoursesService.gradeAssignment(
      id,
      submissionId,
      request,
    );
    return response.status(204).send();
  }
}
