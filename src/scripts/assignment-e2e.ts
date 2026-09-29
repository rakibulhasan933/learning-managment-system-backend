import { createServer } from 'node:http';
import {
  courses,
  enrollments,
  inArray,
  profiles,
  sql,
  users,
} from '../database/index.js';

import { createNestHttpApp } from '../nest.js';
import { databaseClient, db } from '../lib/database.js';
import { signAccessToken } from '../lib/auth-tokens.js';

const expectedTables = [
  'users',
  'refresh_tokens',
  'password_reset_tokens',
  'email_verification_tokens',
  'assignments',
  'assignment_submissions',
] as const;

const expectedColumns: Record<string, string[]> = {
  assignment_submissions: [
    'id',
    'assignment_id',
    'user_id',
    'submission_text',
    'submitted_at',
    'grade_score',
    'grade_feedback',
    'graded_by',
    'graded_at',
    'updated_at',
  ],
  assignments: [
    'id',
    'course_id',
    'section_id',
    'lecture_id',
    'title',
    'instructions',
    'max_score',
    'is_published',
    'due_at',
    'created_at',
    'updated_at',
  ],
  email_verification_tokens: [
    'id',
    'user_id',
    'token_hash',
    'expires_at',
    'used_at',
    'created_at',
  ],
  password_reset_tokens: [
    'id',
    'user_id',
    'token_hash',
    'expires_at',
    'used_at',
    'created_at',
  ],
  refresh_tokens: [
    'id',
    'user_id',
    'token_hash',
    'expires_at',
    'revoked_at',
    'created_at',
  ],
  users: [
    'id',
    'email',
    'password_hash',
    'email_verified_at',
    'google_id',
    'auth_provider',
    'created_at',
    'updated_at',
  ],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifySchema() {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and ${inArray(sql`table_name`, expectedTables)}
    order by table_name
  `);
  const tableNames = new Set(tables.map((row) => row.table_name));

  for (const tableName of expectedTables) {
    assert(tableNames.has(tableName), `Missing table: ${tableName}`);
  }

  const columns = await db.execute<{
    table_name: string;
    column_name: string;
  }>(sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and ${inArray(sql`table_name`, expectedTables)}
    order by table_name, ordinal_position
  `);
  const columnsByTable = new Map<string, string[]>();

  for (const column of columns) {
    columnsByTable.set(column.table_name, [
      ...(columnsByTable.get(column.table_name) ?? []),
      column.column_name,
    ]);
  }

  for (const [tableName, expected] of Object.entries(expectedColumns)) {
    const actual = columnsByTable.get(tableName) ?? [];
    assert(
      expected.every((columnName) => actual.includes(columnName)),
      `Table ${tableName} is missing expected columns. Actual: ${actual.join(', ')}`,
    );
  }

  const constraints = await db.execute<{
    constraint_name: string;
    table_name: string;
  }>(sql`
    select table_name, constraint_name
    from information_schema.table_constraints
    where table_schema = 'public'
      and ${inArray(sql`table_name`, expectedTables)}
    order by table_name, constraint_name
  `);
  const constraintNames = new Set(
    constraints.map((constraint) => constraint.constraint_name),
  );

  for (const constraintName of [
    'assignments_exactly_one_target',
    'assignments_max_score_positive',
    'assignment_submissions_grade_score_non_negative',
    'refresh_tokens_user_id_users_id_fk',
    'password_reset_tokens_user_id_users_id_fk',
    'email_verification_tokens_user_id_users_id_fk',
  ]) {
    assert(
      constraintNames.has(constraintName),
      `Missing expected constraint: ${constraintName}`,
    );
  }

  const indexes = await db.execute<{ indexname: string }>(sql`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and ${inArray(sql`tablename`, expectedTables)}
    order by tablename, indexname
  `);
  const indexNames = new Set(indexes.map((index) => index.indexname));

  for (const indexName of [
    'users_email_unique',
    'users_google_id_unique',
    'refresh_tokens_token_hash_unique',
    'password_reset_tokens_token_hash_unique',
    'email_verification_tokens_token_hash_unique',
    'assignments_section_id_unique',
    'assignments_lecture_id_unique',
    'assignments_course_id_idx',
    'assignment_submissions_assignment_user_unique',
  ]) {
    assert(indexNames.has(indexName), `Missing expected index: ${indexName}`);
  }

  return {
    columns: columns.length,
    constraints: constraints.length,
    indexes: indexes.length,
    tables: tables.length,
  };
}

async function createProfile(role: 'instructor' | 'student', label: string) {
  const email = `assignment-e2e-${label}-${Date.now()}@example.test`;
  const [user] = await db
    .insert(users)
    .values({
      authProvider: 'password',
      email,
      emailVerifiedAt: new Date(),
      passwordHash: 'assignment-e2e-not-used',
    })
    .returning();

  assert(user, `Failed to create ${role} user`);

  const [profile] = await db
    .insert(profiles)
    .values({
      fullName: `Assignment E2E ${label}`,
      role,
      userId: user.id,
    })
    .returning();

  assert(profile, `Failed to create ${role} profile`);

  const accessToken = signAccessToken({
    email,
    profileId: profile.id,
    role,
    sub: user.id,
  });

  return { accessToken, email, profile, user };
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

async function runAssignmentE2E() {
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

    const course = await requestJson<{ id: string }>({
      body: {
        currency: 'BDT',
        level: 'beginner',
        price: 0,
        slug: `assignment-e2e-${Date.now()}`,
        status: 'published',
        title: 'Assignment E2E course',
      },
      method: 'POST',
      token: instructor.accessToken,
      url: `${baseUrl}/instructor/courses`,
    });
    cleanupCourseId = course.id;

    const section = await requestJson<{ id: string }>({
      body: {
        position: 0,
        title: 'Assignment E2E section',
      },
      method: 'POST',
      token: instructor.accessToken,
      url: `${baseUrl}/instructor/courses/${course.id}/sections`,
    });

    await db.insert(enrollments).values({
      courseId: course.id,
      enrolledAt: new Date(),
      status: 'active',
      userId: student.profile.id,
    });

    const assignment = await requestJson<{ id: string; maxScore: number }>({
      body: {
        instructions: 'Submit a short reflection for grading.',
        isPublished: true,
        maxScore: 25,
        title: 'Reflection assignment',
      },
      method: 'PUT',
      token: instructor.accessToken,
      url: `${baseUrl}/instructor/courses/${course.id}/sections/${section.id}/assignment`,
    });

    const submission = await requestJson<{
      id: string;
      gradeScore: number | null;
    }>({
      body: {
        submissionText: "This is the student's assignment submission.",
      },
      method: 'POST',
      token: student.accessToken,
      url: `${baseUrl}/assignments/${assignment.id}/submit`,
    });

    assert(submission.gradeScore === null, 'Submission should start ungraded');

    await requestJson<null>({
      body: {
        gradeFeedback: 'Clear reflection with enough detail.',
        gradeScore: 23,
      },
      method: 'PATCH',
      token: instructor.accessToken,
      url: `${baseUrl}/instructor/courses/${course.id}/assignment-submissions/${submission.id}/grade`,
    });

    const learning = await requestJson<{
      sections: Array<{
        assignment: null | {
          submission: null | {
            gradeFeedback: string | null;
            gradeScore: number | null;
            id: string;
          };
        };
      }>;
    }>({
      method: 'GET',
      token: student.accessToken,
      url: `${baseUrl}/learning/courses/${course.id}`,
    });
    const feedback =
      learning.sections.find((item) => item.assignment)?.assignment
        ?.submission ?? null;

    assert(
      feedback,
      'Student learning response did not include submission feedback',
    );
    assert(
      feedback.id === submission.id,
      'Learning response returned wrong submission',
    );
    assert(feedback.gradeScore === 23, 'Student did not see graded score');
    assert(
      feedback.gradeFeedback === 'Clear reflection with enough detail.',
      'Student did not see grade feedback',
    );

    return {
      assignmentId: assignment.id,
      courseId: course.id,
      gradeScore: feedback.gradeScore,
      submissionId: submission.id,
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
  const schema = await verifySchema();
  const e2e = await runAssignmentE2E();

  console.info(JSON.stringify({ e2e, schema, status: 'ok' }, null, 2));
} finally {
  await databaseClient.end();
}
