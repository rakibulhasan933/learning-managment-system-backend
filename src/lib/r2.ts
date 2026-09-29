import { randomUUID } from 'node:crypto';
import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../config/env.js';
import { HttpError } from '../http/errors.js';

const uploadUrlTtlSeconds = 15 * 60;
const playbackUrlTtlSeconds = 20 * 60;

function getR2Client() {
  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    !env.R2_BUCKET_NAME
  ) {
    throw new HttpError(503, 'R2 video storage is not configured.');
  }

  return new S3Client({
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: 'auto',
  });
}

function getBucketName() {
  if (!env.R2_BUCKET_NAME) {
    throw new HttpError(503, 'R2 video storage is not configured.');
  }

  return env.R2_BUCKET_NAME;
}

function sanitizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function createLectureVideoKey({
  courseId,
  fileName,
  lectureId,
}: {
  courseId: string;
  fileName: string;
  lectureId: string;
}) {
  const safeFileName = sanitizeFileName(fileName) || 'lecture.mp4';

  return `courses/${courseId}/lectures/${lectureId}/${randomUUID()}-${safeFileName}`;
}

export async function createR2UploadUrl({
  contentType,
  key,
}: {
  contentType: string;
  key: string;
}) {
  if (contentType !== 'video/mp4') {
    throw new HttpError(
      400,
      'Only MP4 lecture videos are supported for R2 upload.',
    );
  }

  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    ContentType: contentType,
    Key: key,
  });

  return getSignedUrl(getR2Client(), command, {
    expiresIn: uploadUrlTtlSeconds,
  });
}

export async function createR2PlaybackUrl(key: string) {
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });

  return getSignedUrl(getR2Client(), command, {
    expiresIn: playbackUrlTtlSeconds,
  });
}

export async function uploadLectureVideoToR2({
  body,
  contentType,
  key,
}: {
  body: Buffer;
  contentType: 'video/mp4';
  key: string;
}) {
  const command = new PutObjectCommand({
    Body: body,
    Bucket: getBucketName(),
    ContentType: contentType,
    Key: key,
  });

  await getR2Client().send(command);
}

export async function getR2StorageUsage() {
  try {
    const client = getR2Client();
    const bucket = getBucketName();
    let continuationToken: string | undefined;
    let objects = 0;
    let bytes = 0;
    do {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
        }),
      );
      objects += result.KeyCount ?? result.Contents?.length ?? 0;
      bytes += (result.Contents ?? []).reduce(
        (total, object) => total + Number(object.Size ?? 0),
        0,
      );
      continuationToken = result.NextContinuationToken;
    } while (continuationToken);
    return { objects, bytes };
  } catch {
    return null;
  }
}
