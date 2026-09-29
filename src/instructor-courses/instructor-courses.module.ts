import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InstructorCoursesController } from './instructor-courses.controller.js';
import { InstructorCoursesService } from './instructor-courses.service.js';
import { CourseCrud } from './course-crud/course-crud.js';
import { CourseOutline } from './course-outline/course-outline.js';
import { CourseContent } from './course-content/course-content.js';

@Module({
  imports: [AuthModule],
  controllers: [InstructorCoursesController],
  providers: [
    InstructorCoursesService,
    CourseCrud,
    CourseOutline,
    CourseContent,
  ],
})
export class InstructorCoursesModule {}
