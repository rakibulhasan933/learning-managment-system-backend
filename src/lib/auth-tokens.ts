import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import type { UserRole } from '../types/index.js';

import { env } from '../config/env.js';

const accessTokenTtlSeconds = 15 * 60;
const refreshTokenTtlSeconds = 30 * 24 * 60 * 60;

export const accessTokenCookieName = 'lms_access_token';
export const refreshTokenCookieName = 'lms_refresh_token';

export interface AccessTokenPayload {
  email: string;
  profileId: string;
  role: UserRole;
  sub: string;
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlJson(value: unknown) {
  return base64UrlEncode(JSON.stringify(value));
}

function sign(input: string, secret: string) {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function signAccessToken(payload: AccessTokenPayload) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64UrlJson({
    ...payload,
    exp: now + accessTokenTtlSeconds,
    iat: now,
  });
  const input = `${header}.${body}`;

  return `${input}.${sign(input, env.JWT_ACCESS_SECRET)}`;
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const [header, body, signature] = token.split('.');

  if (!header || !body || !signature) {
    throw new Error('Invalid token.');
  }

  const expectedSignature = sign(`${header}.${body}`, env.JWT_ACCESS_SECRET);

  if (!safeEqual(signature, expectedSignature)) {
    throw new Error('Invalid token signature.');
  }

  const payload = JSON.parse(
    Buffer.from(body, 'base64url').toString('utf8'),
  ) as AccessTokenPayload & { exp?: number };

  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired.');
  }

  return payload;
}

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string) {
  return createHmac('sha256', env.JWT_REFRESH_SECRET)
    .update(token)
    .digest('hex');
}

export function hashActionToken(token: string) {
  return createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(token)
    .digest('hex');
}

export function getRefreshTokenExpiresAt() {
  return new Date(Date.now() + refreshTokenTtlSeconds * 1000);
}

export function setAuthCookies(
  response: Response,
  accessToken: string,
  refreshToken: string,
) {
  const secure = env.NODE_ENV === 'production';

  response.cookie(accessTokenCookieName, accessToken, {
    httpOnly: true,
    maxAge: accessTokenTtlSeconds * 1000,
    path: '/',
    sameSite: 'lax',
    secure,
  });
  response.cookie(refreshTokenCookieName, refreshToken, {
    httpOnly: true,
    maxAge: refreshTokenTtlSeconds * 1000,
    path: '/',
    sameSite: 'lax',
    secure,
  });
}

export function clearAuthCookies(response: Response) {
  response.clearCookie(accessTokenCookieName, { path: '/' });
  response.clearCookie(refreshTokenCookieName, { path: '/' });
}
