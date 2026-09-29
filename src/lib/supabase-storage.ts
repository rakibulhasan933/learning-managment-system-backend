import { randomUUID } from 'node:crypto';

import { env } from '../config/env.js';
import { HttpError } from '../http/errors.js';

const defaultPaymentProofBucket = 'payment-proofs';
const defaultCertificatesBucket = 'certificates';
const defaultLectureMaterialsBucket = 'lecture-materials';
const defaultCourseThumbnailsBucket = 'course-thumbnails';
const defaultProfileAvatarsBucket = 'profile-avatars';
const maxProofBytes = 5 * 1024 * 1024;
const maxLectureMaterialBytes = 25 * 1024 * 1024;
const maxImageBytes = 5 * 1024 * 1024;
const allowedImageContentTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function getSupabaseStorageUrl() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(503, 'Supabase Storage is not configured.');
  }

  const url = new URL(env.SUPABASE_URL);
  let projectUrl: URL;

  if (url.protocol === 'https:' || url.protocol === 'http:') {
    projectUrl = url;
  } else if (url.protocol === 'postgres:' || url.protocol === 'postgresql:') {
    const directHostMatch = url.hostname.match(
      /^db\.([a-z0-9]+)\.supabase\.co$/i,
    );
    const poolerUserMatch = decodeURIComponent(url.username).match(
      /^postgres\.([a-z0-9]+)$/i,
    );
    const projectRef = directHostMatch?.[1] ?? poolerUserMatch?.[1];

    if (!projectRef) {
      throw new HttpError(
        503,
        'Supabase Storage URL must be an HTTP(S) project URL or a Supabase Postgres URL with a project ref.',
      );
    }

    projectUrl = new URL(`https://${projectRef}.supabase.co`);
  } else {
    throw new HttpError(
      503,
      'Supabase Storage URL must be an HTTP(S) project URL.',
    );
  }

  return {
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    url: projectUrl,
  };
}

async function ensureStorageBucket({
  bucket,
  isPublic,
  serviceRoleKey,
  url,
}: {
  bucket: string;
  isPublic: boolean;
  serviceRoleKey: string;
  url: URL;
}) {
  const bucketUrl = new URL(`/storage/v1/bucket/${bucket}`, url);
  const existingResponse = await fetch(bucketUrl, {
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  });

  if (existingResponse.ok) {
    return;
  }

  const existingBody = await existingResponse.text().catch(() => '');
  const isMissingBucket =
    existingResponse.status === 404 ||
    (existingResponse.status === 400 &&
      existingBody.toLowerCase().includes('bucket not found'));

  if (!isMissingBucket) {
    throw new HttpError(502, 'Supabase Storage bucket lookup failed.');
  }

  const createResponse = await fetch(new URL('/storage/v1/bucket', url), {
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: isPublic,
    }),
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
    },
    method: 'POST',
  });

  if (!createResponse.ok && createResponse.status !== 409) {
    throw new HttpError(502, 'Supabase Storage bucket creation failed.');
  }
}

function sanitizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function validateLectureMaterialType(kind: 'pdf' | 'slides', contentType: string) {
  const allowedContentTypes =
    kind === 'pdf'
      ? ['application/pdf']
      : [
          'application/pdf',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.oasis.opendocument.presentation',
        ];

  if (!allowedContentTypes.includes(contentType)) {
    throw new HttpError(
      400,
      kind === 'pdf'
        ? 'Lecture PDF must be an application/pdf file.'
        : 'Lecture slides must be a PDF, PPT, PPTX, or ODP file.',
    );
  }
}

export async function createLectureMaterialUploadUrl({
  courseId,
  fileName,
  kind,
  contentType,
  resourceId,
}: {
  courseId: string;
  fileName: string;
  kind: 'pdf' | 'slides';
  contentType: string;
  resourceId: string;
}) {
  validateLectureMaterialType(kind, contentType);
  const storage = getSupabaseStorageUrl();
  const bucket =
    env.SUPABASE_STORAGE_LECTURE_MATERIALS_BUCKET ??
    defaultLectureMaterialsBucket;

  await ensureStorageBucket({
    bucket,
    isPublic: true,
    serviceRoleKey: storage.serviceRoleKey,
    url: storage.url,
  });

  const extension =
    fileName.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() ||
    (kind === 'pdf' ? 'pdf' : 'pptx');
  const objectKey = `${courseId}/${resourceId}/${kind}-${randomUUID()}.${extension}`;
  const signUrl = new URL(
    `/storage/v1/object/upload/sign/${bucket}/${objectKey}`,
    storage.url,
  );
  const response = await fetch(signUrl, {
    headers: {
      Authorization: `Bearer ${storage.serviceRoleKey}`,
      apikey: storage.serviceRoleKey,
    },
    method: 'POST',
  });
  const payload = (await response.json().catch(() => null)) as {
    token?: string;
  } | null;
  if (!response.ok || !payload?.token) {
    throw new HttpError(502, 'Supabase signed upload URL could not be created.');
  }

  const uploadUrl = new URL(
    `/storage/v1/object/upload/sign/${bucket}/${objectKey}?token=${encodeURIComponent(payload.token)}`,
    storage.url,
  );
  const publicUrl = new URL(
    `/storage/v1/object/public/${bucket}/${objectKey}`,
    storage.url,
  );

  return {
    expiresInSeconds: 15 * 60,
    headers: { 'Content-Type': contentType },
    objectKey,
    publicUrl: publicUrl.toString(),
    uploadUrl: uploadUrl.toString(),
  };
}

async function uploadPublicObject({
  body,
  bucket,
  contentType,
  fileName,
  objectPrefix,
}: {
  body: Buffer;
  bucket: string;
  contentType: string;
  fileName: string;
  objectPrefix: string;
}) {
  const storage = getSupabaseStorageUrl();

  await ensureStorageBucket({
    bucket,
    isPublic: true,
    serviceRoleKey: storage.serviceRoleKey,
    url: storage.url,
  });

  const safeFileName = sanitizeFileName(fileName) || 'file';
  const objectKey = `${objectPrefix}/${randomUUID()}-${safeFileName}`;
  const uploadUrl = new URL(
    `/storage/v1/object/${bucket}/${objectKey}`,
    storage.url,
  );

  const response = await fetch(uploadUrl, {
    body: body as unknown as BodyInit,
    headers: {
      Authorization: `Bearer ${storage.serviceRoleKey}`,
      'Content-Type': contentType,
      apikey: storage.serviceRoleKey,
      'x-upsert': 'true',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError(502, 'Supabase Storage upload failed.');
  }

  return new URL(
    `/storage/v1/object/public/${bucket}/${objectKey}`,
    storage.url,
  ).toString();
}

export async function uploadPaymentProofScreenshot({
  base64,
  contentType,
  fileName,
  orderId,
}: {
  base64: string;
  contentType: string;
  fileName: string;
  orderId: string;
}) {
  const storage = getSupabaseStorageUrl();

  if (!contentType.startsWith('image/')) {
    throw new HttpError(400, 'Payment proof must be an image.');
  }

  const body = Buffer.from(base64, 'base64');

  if (body.length > maxProofBytes) {
    throw new HttpError(400, 'Payment proof image must be 5 MB or smaller.');
  }

  const bucket =
    env.SUPABASE_STORAGE_PAYMENT_PROOFS_BUCKET ?? defaultPaymentProofBucket;
  await ensureStorageBucket({
    bucket,
    isPublic: true,
    serviceRoleKey: storage.serviceRoleKey,
    url: storage.url,
  });
  const extension =
    fileName
      .split('.')
      .pop()
      ?.replace(/[^a-z0-9]/gi, '') || 'jpg';
  const objectKey = `${orderId}/${randomUUID()}.${extension}`;
  const uploadUrl = new URL(
    `/storage/v1/object/${bucket}/${objectKey}`,
    storage.url,
  );

  const response = await fetch(uploadUrl, {
    body: body as unknown as BodyInit,
    headers: {
      Authorization: `Bearer ${storage.serviceRoleKey}`,
      'Content-Type': contentType,
      apikey: storage.serviceRoleKey,
      'x-upsert': 'true',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError(502, 'Payment proof upload failed.');
  }

  return new URL(
    `/storage/v1/object/public/${bucket}/${objectKey}`,
    storage.url,
  ).toString();
}

export async function uploadCertificatePdf({
  certificateId,
  pdf,
}: {
  certificateId: string;
  pdf: Buffer;
}) {
  const storage = getSupabaseStorageUrl();

  const bucket =
    env.SUPABASE_STORAGE_CERTIFICATES_BUCKET ?? defaultCertificatesBucket;
  await ensureStorageBucket({
    bucket,
    isPublic: true,
    serviceRoleKey: storage.serviceRoleKey,
    url: storage.url,
  });
  const objectKey = `${certificateId}/certificate.pdf`;
  const uploadUrl = new URL(
    `/storage/v1/object/${bucket}/${objectKey}`,
    storage.url,
  );

  const response = await fetch(uploadUrl, {
    body: pdf as unknown as BodyInit,
    headers: {
      Authorization: `Bearer ${storage.serviceRoleKey}`,
      'Content-Type': 'application/pdf',
      apikey: storage.serviceRoleKey,
      'x-upsert': 'true',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError(502, 'Certificate upload failed.');
  }

  return new URL(
    `/storage/v1/object/public/${bucket}/${objectKey}`,
    storage.url,
  ).toString();
}

export async function uploadLectureMaterial({
  base64,
  body: providedBody,
  contentType,
  courseId,
  fileName,
  kind,
  lectureId,
}: {
  base64?: string;
  body?: Buffer;
  contentType: string;
  courseId: string;
  fileName: string;
  kind: 'pdf' | 'slides';
  lectureId: string;
}) {
  const allowedContentTypes =
    kind === 'pdf'
      ? ['application/pdf']
      : [
          'application/pdf',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.oasis.opendocument.presentation',
        ];

  if (!allowedContentTypes.includes(contentType)) {
    throw new HttpError(
      400,
      kind === 'pdf'
        ? 'Lecture PDF must be an application/pdf file.'
        : 'Lecture slides must be a PDF, PPT, PPTX, or ODP file.',
    );
  }

  const body = providedBody ?? Buffer.from(base64 ?? '', 'base64');

  if (body.length > maxLectureMaterialBytes) {
    throw new HttpError(400, 'Lecture material must be 25 MB or smaller.');
  }

  const storage = getSupabaseStorageUrl();
  const bucket =
    env.SUPABASE_STORAGE_LECTURE_MATERIALS_BUCKET ??
    defaultLectureMaterialsBucket;

  await ensureStorageBucket({
    bucket,
    isPublic: true,
    serviceRoleKey: storage.serviceRoleKey,
    url: storage.url,
  });

  const extension =
    fileName
      .split('.')
      .pop()
      ?.replace(/[^a-z0-9]/gi, '')
      .toLowerCase() || (kind === 'pdf' ? 'pdf' : 'pptx');
  const objectKey = `${courseId}/${lectureId}/${kind}-${randomUUID()}.${extension}`;
  const uploadUrl = new URL(
    `/storage/v1/object/${bucket}/${objectKey}`,
    storage.url,
  );
  const response = await fetch(uploadUrl, {
    body: body as unknown as BodyInit,
    headers: {
      Authorization: `Bearer ${storage.serviceRoleKey}`,
      'Content-Type': contentType,
      apikey: storage.serviceRoleKey,
      'x-upsert': 'true',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError(502, 'Lecture material upload failed.');
  }

  return new URL(
    `/storage/v1/object/public/${bucket}/${objectKey}`,
    storage.url,
  ).toString();
}

export async function uploadCourseThumbnailImage({
  base64,
  contentType,
  fileName,
}: {
  base64: string;
  contentType: string;
  fileName: string;
}) {
  if (!allowedImageContentTypes.has(contentType)) {
    throw new HttpError(
      400,
      'Course thumbnail must be a JPG, PNG, WEBP, GIF, or AVIF image.',
    );
  }

  const body = Buffer.from(base64, 'base64');

  if (body.length > maxImageBytes) {
    throw new HttpError(400, 'Course thumbnail image must be 5 MB or smaller.');
  }

  const bucket =
    env.SUPABASE_STORAGE_COURSE_THUMBNAILS_BUCKET ??
    defaultCourseThumbnailsBucket;

  return uploadPublicObject({
    body,
    bucket,
    contentType,
    fileName,
    objectPrefix: 'course-thumbnails',
  });
}

export async function uploadProfileAvatarImage({
  base64,
  contentType,
  fileName,
}: {
  base64: string;
  contentType: string;
  fileName: string;
}) {
  if (!allowedImageContentTypes.has(contentType)) {
    throw new HttpError(
      400,
      'Profile avatar must be a JPG, PNG, WEBP, GIF, or AVIF image.',
    );
  }

  const body = Buffer.from(base64, 'base64');

  if (body.length > maxImageBytes) {
    throw new HttpError(400, 'Profile avatar image must be 5 MB or smaller.');
  }

  const bucket =
    env.SUPABASE_STORAGE_PROFILE_AVATARS_BUCKET ?? defaultProfileAvatarsBucket;

  return uploadPublicObject({
    body,
    bucket,
    contentType,
    fileName,
    objectPrefix: 'profile-avatars',
  });
}
