import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const serviceDirectory = resolve(moduleDirectory, '../..');
// The monorepo root is one level above backend-with-nestjs.
const rootEnvPath = resolve(serviceDirectory, '../.env');
const serviceEnvPath = resolve(serviceDirectory, '.env');

const rootEnv = config({ path: rootEnvPath }).parsed ?? {};
config({ path: serviceEnvPath, override: true });

for (const [key, value] of Object.entries(rootEnv)) {
  if (process.env[key] === '' && value) {
    process.env[key] = value;
  }
}

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: optionalUrl,
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmptyString,
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  GOOGLE_OAUTH_CLIENT_ID: optionalNonEmptyString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalNonEmptyString,
  GOOGLE_OAUTH_REDIRECT_URI: optionalUrl,
  GMAIL_SMTP_USER: optionalNonEmptyString,
  GMAIL_SMTP_APP_PASSWORD: optionalNonEmptyString,
  MANUAL_PAYMENT_BKASH_NUMBER: optionalNonEmptyString,
  MANUAL_PAYMENT_NAGAD_NUMBER: optionalNonEmptyString,
  MANUAL_PAYMENT_ROCKET_NUMBER: optionalNonEmptyString,
  MANUAL_PAYMENT_BANK_DETAILS: optionalNonEmptyString,
  MANUAL_PAYMENT_COUPONS: optionalNonEmptyString,
  PAYCONFIRM_API_KEY: optionalNonEmptyString,
  PAYCONFIRM_API_URL: optionalUrl,
  SUPABASE_STORAGE_COURSE_THUMBNAILS_BUCKET: optionalNonEmptyString,
  SUPABASE_STORAGE_PAYMENT_PROOFS_BUCKET: optionalNonEmptyString,
  SUPABASE_STORAGE_CERTIFICATES_BUCKET: optionalNonEmptyString,
  SUPABASE_STORAGE_LECTURE_MATERIALS_BUCKET: optionalNonEmptyString,
  SUPABASE_STORAGE_PROFILE_AVATARS_BUCKET: optionalNonEmptyString,
  R2_ACCOUNT_ID: optionalNonEmptyString,
  R2_ACCESS_KEY_ID: optionalNonEmptyString,
  R2_SECRET_ACCESS_KEY: optionalNonEmptyString,
  R2_BUCKET_NAME: optionalNonEmptyString,
});

const parsedEnvironment = environmentSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  GMAIL_SMTP_USER: process.env.GMAIL_SMTP_USER,
  GMAIL_SMTP_APP_PASSWORD: process.env.GMAIL_SMTP_APP_PASSWORD,
  MANUAL_PAYMENT_BKASH_NUMBER: process.env.MANUAL_PAYMENT_BKASH_NUMBER,
  MANUAL_PAYMENT_NAGAD_NUMBER: process.env.MANUAL_PAYMENT_NAGAD_NUMBER,
  MANUAL_PAYMENT_ROCKET_NUMBER: process.env.MANUAL_PAYMENT_ROCKET_NUMBER,
  MANUAL_PAYMENT_BANK_DETAILS: process.env.MANUAL_PAYMENT_BANK_DETAILS,
  MANUAL_PAYMENT_COUPONS: process.env.MANUAL_PAYMENT_COUPONS,
  PAYCONFIRM_API_KEY: process.env.PAYCONFIRM_API_KEY,
  PAYCONFIRM_API_URL: process.env.PAYCONFIRM_API_URL,
  SUPABASE_STORAGE_COURSE_THUMBNAILS_BUCKET:
    process.env.SUPABASE_STORAGE_COURSE_THUMBNAILS_BUCKET,
  SUPABASE_STORAGE_PAYMENT_PROOFS_BUCKET:
    process.env.SUPABASE_STORAGE_PAYMENT_PROOFS_BUCKET,
  SUPABASE_STORAGE_CERTIFICATES_BUCKET:
    process.env.SUPABASE_STORAGE_CERTIFICATES_BUCKET,
  SUPABASE_STORAGE_LECTURE_MATERIALS_BUCKET:
    process.env.SUPABASE_STORAGE_LECTURE_MATERIALS_BUCKET,
  SUPABASE_STORAGE_PROFILE_AVATARS_BUCKET:
    process.env.SUPABASE_STORAGE_PROFILE_AVATARS_BUCKET,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
});

if (!parsedEnvironment.success) {
  throw new Error(
    `Invalid backend environment: ${parsedEnvironment.error.issues
      .map((issue) => issue.path.join('.'))
      .join(', ')}`,
  );
}

export const env = parsedEnvironment.data;
