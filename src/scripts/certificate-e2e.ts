import { createServer } from 'node:http';
import {
  certificates,
  courses,
  enrollments,
  lectures,
  profiles,
  sections,
  sql,
  users,
} from '../database/index.js';
import type {
  CertificateListResponse,
  LectureProgressMutationResponse,
} from '../types/index.js';

import { createNestHttpApp } from '../nest.js';
import { databaseClient, db } from '../lib/database.js';
import { signAccessToken } from '../lib/auth-tokens.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function createProfile(role: 'instructor' | 'student', label: string) {
  const email = `certificate-e2e-${label}-${Date.now()}@example.test`;
  const [user] = await db
    .insert(users)
    .values({
      authProvider: 'password',
      email,
      emailVerifiedAt: new Date(),
      passwordHash: 'certificate-e2e-not-used',
    })
    .returning();

  assert(user, `Failed to create ${role} user`);

  const [profile] = await db
    .insert(profiles)
    .values({
      fullName: `Certificate E2E ${label}`,
      role,
      userId: user.id,
    })
    .returning();

  assert(profile, `Failed to create ${role} profile`);

  return {
    accessToken: signAccessToken({
      email,
      profileId: profile.id,
      role,
      sub: user.id,
    }),
    email,
    profile,
    user,
  };
}

async function requestJson<T>({
  body,
  method,
  token,
  url,
}: {
  body?: unknown;
  method: string;
  token: string;
  url: string;
}) {
  const response = await fetch(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    method,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  assert(
    response.ok,
    `${method} ${url} failed with ${response.status}: ${text}`,
  );

  return payload as T;
}

async function runCertificateE2E() {
  const app = await createNestHttpApp();
  const server = createServer(app);
  const cleanupUserIds: string[] = [];
  let cleanupCourseId: string | null = null;

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert(address && typeof address === 'object', 'Test server did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const instructor = await createProfile('instructor', 'instructor');
    const student = await createProfile('student', 'student');
    cleanupUserIds.push(instructor.user.id, student.user.id);

    const [course] = await db
      .insert(courses)
      .values({
        currency: 'BDT',
        instructorId: instructor.profile.id,
        level: 'beginner',
        price: '0',
        publishedAt: new Date(),
        slug: `certificate-e2e-${Date.now()}`,
        status: 'published',
        title: 'Certificate E2E course',
      })
      .returning();

    assert(course, 'Failed to create course');
    cleanupCourseId = course.id;

    const [section] = await db
      .insert(sections)
      .values({
        courseId: course.id,
        position: 0,
        title: 'Certificate E2E section',
      })
      .returning();

    assert(section, 'Failed to create section');

    const lectureRows = await db
      .insert(lectures)
      .values([
        {
          durationSeconds: 60,
          isPublished: true,
          position: 0,
          sectionId: section.id,
          title: 'Published lecture one',
        },
        {
          durationSeconds: 90,
          isPublished: true,
          position: 1,
          sectionId: section.id,
          title: 'Published lecture two',
        },
        {
          durationSeconds: 30,
          isPublished: false,
          position: 2,
          sectionId: section.id,
          title: 'Unpublished lecture does not count',
        },
      ])
      .returning();

    assert(lectureRows.length === 3, 'Failed to create lectures');

    await db.insert(enrollments).values({
      courseId: course.id,
      enrolledAt: new Date(),
      status: 'active',
      userId: student.profile.id,
    });

    const publishedLectures = lectureRows.filter(
      (lecture) => lecture.isPublished,
    );

    for (const lecture of publishedLectures) {
      const savedProgress = await requestJson<LectureProgressMutationResponse>({
        body: {
          isCompleted: true,
          positionSeconds: lecture.durationSeconds ?? 0,
        },
        method: 'PUT',
        token: student.accessToken,
        url: `${baseUrl}/progress/lectures/${lecture.id}`,
      });

      assert(
        savedProgress.progress.isCompleted,
        `Lecture ${lecture.id} was not marked complete`,
      );
    }

    const certificateList = await requestJson<CertificateListResponse>({
      method: 'GET',
      token: student.accessToken,
      url: `${baseUrl}/certificates`,
    });
    const certificate = certificateList.certificates.find(
      (item) => item.courseId === course.id,
    );

    assert(certificate, 'Certificate was not generated for completed course');
    assert(
      certificate.certificateUrl.endsWith('/certificate.pdf'),
      'Certificate URL does not point to a generated PDF',
    );

    const [storedCertificate] = await db
      .select()
      .from(certificates)
      .where(
        sql`${certificates.userId} = ${student.profile.id} and ${certificates.courseId} = ${course.id}`,
      )
      .limit(1);

    assert(storedCertificate, 'Certificate was not persisted');

    return {
      certificateId: certificate.id,
      courseId: course.id,
      publishedLectureCount: publishedLectures.length,
      verificationCode: certificate.verificationCode,
    };
  } finally {
    if (cleanupCourseId) {
      await db
        .delete(enrollments)
        .where(sql`${enrollments.courseId} = ${cleanupCourseId}`);
      await db.delete(courses).where(sql`${courses.id} = ${cleanupCourseId}`);
    }

    for (const userId of cleanupUserIds) {
      await db.delete(users).where(sql`${users.id} = ${userId}`);
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

try {
  const e2e = await runCertificateE2E();

  console.info(JSON.stringify({ e2e, status: 'ok' }, null, 2));
} finally {
  await databaseClient.end();
}
