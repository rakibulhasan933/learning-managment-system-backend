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
import { SalesModule } from './sales/sales.module.js';
import { ExamsModule } from './exams/exams.module.js';
import { BatchesModule } from './batches/batches.module.js';
import { AffiliatesModule } from './affiliates/affiliates.module.js';
import { LiveClassesModule } from './live-classes/live-classes.module.js';
import { RevisionModule } from './revision/revision.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { RefundRequestsModule } from './refund-requests/refund-requests.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
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
    SalesModule,
    ExamsModule,
    BatchesModule,
    AffiliatesModule,
    LiveClassesModule,
    RevisionModule,
    ReviewsModule,
    RefundRequestsModule,
    AnalyticsModule,
    NotificationsModule,
    MessagingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
