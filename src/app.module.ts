import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { CoursesModule } from './courses/courses.module.js';
import { LearningModule } from './learning/learning.module.js';
import { ProgressModule } from './progress/progress.module.js';
import { QuizzesModule } from './quizzes/quizzes.module.js';
import { AssignmentsModule } from './assignments/assignments.module.js';
import { LecturesModule } from './lectures/lectures.module.js';
import { CertificatesModule } from './certificates/certificates.module.js';
import { CommunityModule } from './community/community.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { StudentDashboardModule } from './student-dashboard/student-dashboard.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { AdminModule } from './admin/admin.module.js';
import { InstructorCoursesModule } from './instructor-courses/instructor-courses.module.js';
import { InstructorDashboardModule } from './instructor-dashboard/instructor-dashboard.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { AuthMiddleware } from './middleware/auth.middleware.js';

@Module({
  controllers: [HealthController],
  imports: [
    DatabaseModule,
    AuthModule,
    CoursesModule,
    LearningModule,
    ProgressModule,
    QuizzesModule,
    AssignmentsModule,
    LecturesModule,
    CertificatesModule,
    CommunityModule,
    UploadsModule,
    StudentDashboardModule,
    PaymentsModule,
    AdminModule,
    InstructorCoursesModule,
    InstructorDashboardModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
