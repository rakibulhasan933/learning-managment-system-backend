import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { AdminOverview } from './admin-overview/admin-overview.js';
import { AdminUsers } from './admin-users/admin-users.js';
import { AdminCourses } from './admin-courses/admin-courses.js';
import { AdminFinance } from './admin-finance/admin-finance.js';
import { AdminSettings } from './admin-settings/admin-settings.js';
import { AdminCoupons } from './admin-coupons/admin-coupons.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [
    AdminOverview,
    AdminUsers,
    AdminCourses,
    AdminFinance,
    AdminSettings,
    AdminCoupons,
  ],
})
export class AdminModule {}
