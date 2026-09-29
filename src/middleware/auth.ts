import type { NextFunction, Request, Response } from 'express';
import type { Profile } from '../database/index.js';
import type { UserRole } from '../types/index.js';

import {
  accessTokenCookieName,
  type AccessTokenPayload,
  verifyAccessToken,
} from '../lib/auth-tokens.js';
import { getProfileByUserId } from '../lib/profiles.js';

export interface AuthContext {
  profile: Profile & { email: string; suspendedAt?: Date | null };
  token: AccessTokenPayload;
}

declare global {
  // Express exposes request augmentation through this namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function parseCookies(header: string | undefined) {
  return Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf('=');

        if (separatorIndex === -1) {
          return [part, ''];
        }

        return [
          decodeURIComponent(part.slice(0, separatorIndex)),
          decodeURIComponent(part.slice(separatorIndex + 1)),
        ];
      }),
  );
}

function getBearerToken(request: Request) {
  const authorization = request.get('authorization');
  const bearerMatch = authorization?.match(/^Bearer\s+(\S+)$/i);

  return (
    bearerMatch?.[1] ??
    parseCookies(request.get('cookie'))[accessTokenCookieName] ??
    null
  );
}

function sendUnauthorized(response: Response) {
  return response.status(401).json({ message: 'Authentication is required.' });
}

export async function requireAuth(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return sendUnauthorized(response);
  }

  try {
    const token = verifyAccessToken(accessToken);
    const profile = await getProfileByUserId(token.sub);

    if (!profile || profile.suspendedAt) {
      return sendUnauthorized(response);
    }

    request.auth = { profile, token };

    return next();
  } catch {
    return sendUnauthorized(response);
  }
}

export async function optionalAuth(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return next();
  }

  try {
    const token = verifyAccessToken(accessToken);
    const profile = await getProfileByUserId(token.sub);

    if (profile && !profile.suspendedAt) {
      request.auth = { profile, token };
    }
  } catch {
    // An invalid or expired token is treated as an anonymous visitor.
  }

  return next();
}

export function requireRole(roles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.auth?.profile) {
      return sendUnauthorized(response);
    }

    if (!roles.includes(request.auth.profile.role)) {
      return response.status(403).json({ message: 'Access denied.' });
    }

    return next();
  };
}
