import { HttpException, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import type {
  CertificateDownloadResponse,
  CertificateDto,
  CertificateListResponse,
  CertificateVerificationResponse,
} from '../types/index.js';
import {
  and,
  certificates,
  courses,
  enrollments,
  eq,
  modules,
  profiles,
  sections,
  sql,
  users,
  videoProgress,
  videos,
} from '../database/index.js';

import { AuthService } from '../auth/auth.service.js';
import { db } from '../lib/database.js';
import { generateCertificatePdf } from '../lib/certificate-pdf.js';
import { uploadCertificatePdf } from '../lib/supabase-storage.js';

const certificateIdSchema = z.string().uuid();

type CertificateRow = {
  certificateUrl: string;
  courseId: string;
  courseTitle: string;
  id: string;
  issuedAt: Date;
  studentEmail: string;
  studentName: string | null;
  verificationCode: string;
};

function parseId(value: string) {
  try {
    return certificateIdSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new HttpException(
        { message: 'Invalid request payload.', issues: error.issues },
        400,
      );
    }
    throw error;
  }
}

function toCertificateDto(row: CertificateRow): CertificateDto {
  return {
    certificateUrl: row.certificateUrl,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    id: row.id,
    issuedAt: row.issuedAt.toISOString(),
    studentName: row.studentName ?? row.studentEmail,
    verificationCode: row.verificationCode,
  };
}

function createVerificationCode() {
  return `CERT-${randomBytes(6).toString('hex').toUpperCase()}`;
}

@Injectable()
export class CertificatesService {
  constructor(private readonly authService: AuthService) {}

  private async getProfile(request: Request) {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile || !['admin', 'student'].includes(profile.role)) {
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    }
    return profile;
  }

  private async completedCourseIds(profileId: string) {
    const rows = await db
      .select({
        completedLectures: sql<number>`count(${videoProgress.id}) filter (where ${videoProgress.isCompleted} = true)`,
        courseId: courses.id,
        totalLectures: sql<number>`count(${videos.id})`,
      })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .innerJoin(sections, eq(sections.courseId, courses.id))
      .innerJoin(modules, eq(modules.milestoneId, sections.id))
      .innerJoin(videos, eq(videos.moduleId, modules.id))
      .leftJoin(
        videoProgress,
        and(
          eq(videoProgress.videoId, videos.id),
          eq(videoProgress.userId, enrollments.userId),
        ),
      )
      .where(
        and(
          eq(enrollments.userId, profileId),
          eq(enrollments.status, 'active'),
          eq(videos.isPublished, true),
        ),
      )
      .groupBy(courses.id);

    return rows
      .filter(
        (row) =>
          Number(row.totalLectures) > 0 &&
          Number(row.completedLectures) === Number(row.totalLectures),
      )
      .map((row) => row.courseId);
  }

  private async issueCertificate(profileId: string, courseId: string) {
    const [existing] = await db
      .select({ id: certificates.id })
      .from(certificates)
      .where(
        and(
          eq(certificates.userId, profileId),
          eq(certificates.courseId, courseId),
        ),
      )
      .limit(1);
    if (existing) return;

    const [details] = await db
      .select({
        courseTitle: courses.title,
        studentEmail: users.email,
        studentName: profiles.fullName,
      })
      .from(courses)
      .innerJoin(profiles, eq(profiles.id, profileId))
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(eq(courses.id, courseId))
      .limit(1);
    if (!details) return;

    const certificateId = randomUUID();
    const issuedAt = new Date();
    const verificationCode = createVerificationCode();
    const pdf = generateCertificatePdf({
      completionDate: issuedAt,
      courseTitle: details.courseTitle,
      studentName: details.studentName ?? details.studentEmail,
      verificationCode,
    });
    const certificateUrl = await uploadCertificatePdf({ certificateId, pdf });

    await db
      .insert(certificates)
      .values({
        certificateUrl,
        courseId,
        id: certificateId,
        issuedAt,
        userId: profileId,
        verificationCode,
      })
      .onConflictDoNothing();
  }

  private async issueMissingCertificates(profileId: string) {
    for (const courseId of await this.completedCourseIds(profileId)) {
      await this.issueCertificate(profileId, courseId);
    }
  }

  /**
   * Public verification: anyone with a code printed on a certificate PDF
   * can check it. Codes are generated as `CERT-<uppercase hex>`, so the
   * input is trimmed and uppercased before an exact match. Only the four
   * contracted fields are returned — no email, order, certificate URL or
   * internal ids.
   */
  async verify(codeInput: string): Promise<CertificateVerificationResponse> {
    const code = codeInput.trim().toUpperCase();
    if (!code) {
      return {
        courseTitle: null,
        issuedAt: null,
        studentName: null,
        valid: false,
      };
    }
    const [row] = await db
      .select({
        courseTitle: courses.title,
        issuedAt: certificates.issuedAt,
        studentName: profiles.fullName,
      })
      .from(certificates)
      .innerJoin(courses, eq(certificates.courseId, courses.id))
      .innerJoin(profiles, eq(certificates.userId, profiles.id))
      .where(eq(certificates.verificationCode, code))
      .limit(1);
    if (!row) {
      return {
        courseTitle: null,
        issuedAt: null,
        studentName: null,
        valid: false,
      };
    }
    return {
      courseTitle: row.courseTitle,
      issuedAt: row.issuedAt.toISOString(),
      studentName: row.studentName,
      valid: true,
    };
  }

  async list(request: Request): Promise<CertificateListResponse> {
    const profile = await this.getProfile(request);
    await this.issueMissingCertificates(profile.id);
    const rows = (await db
      .select({
        certificateUrl: certificates.certificateUrl,
        courseId: certificates.courseId,
        courseTitle: courses.title,
        id: certificates.id,
        issuedAt: certificates.issuedAt,
        studentEmail: users.email,
        studentName: profiles.fullName,
        verificationCode: certificates.verificationCode,
      })
      .from(certificates)
      .innerJoin(courses, eq(certificates.courseId, courses.id))
      .innerJoin(profiles, eq(certificates.userId, profiles.id))
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(eq(certificates.userId, profile.id))
      .orderBy(sql`${certificates.issuedAt} desc`)) as CertificateRow[];

    return { certificates: rows.map(toCertificateDto) };
  }

  private async getCertificate(certificateIdInput: string, request: Request) {
    const profile = await this.getProfile(request);
    const certificateId = parseId(certificateIdInput);
    const [certificate] = await db
      .select({
        certificateUrl: certificates.certificateUrl,
        userId: certificates.userId,
      })
      .from(certificates)
      .where(eq(certificates.id, certificateId))
      .limit(1);
    if (!certificate) {
      throw new HttpException({ message: 'Certificate not found.' }, 404);
    }
    if (certificate.userId !== profile.id) {
      throw new HttpException({ message: 'Access denied.' }, 403);
    }
    return certificate;
  }

  async downloadUrl(
    certificateId: string,
    request: Request,
  ): Promise<CertificateDownloadResponse> {
    const certificate = await this.getCertificate(certificateId, request);
    return { downloadUrl: certificate.certificateUrl };
  }

  async download(certificateId: string, request: Request) {
    return (await this.getCertificate(certificateId, request)).certificateUrl;
  }
}
