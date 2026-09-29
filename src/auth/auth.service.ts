import { HttpException, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import {
  and,
  emailVerificationTokens,
  eq,
  isNull,
  passwordResetTokens,
  profiles,
  refreshTokens,
  users,
} from '../database/index.js';
import type { AuthSessionDto } from '../types/index.js';

import {
  accessTokenCookieName,
  clearAuthCookies,
  createOpaqueToken,
  getRefreshTokenExpiresAt,
  hashActionToken,
  hashRefreshToken,
  refreshTokenCookieName,
  setAuthCookies,
  signAccessToken,
  type AccessTokenPayload,
  verifyAccessToken,
} from '../lib/auth-tokens.js';
import { db } from '../lib/database.js';
import { env } from '../config/env.js';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../lib/mailer.js';
import { getProfileByUserId, toProfileDto } from '../lib/profiles.js';

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1),
});
const signupSchema = loginSchema.extend({
  fullName: z.string().trim().min(1).max(160).nullable().optional(),
  origin: z.string().url().optional(),
});
const resetRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  origin: z.string().url().optional(),
});
const resetConfirmSchema = z.object({
  password: z.string().min(8),
  token: z.string().min(20),
});
const profileUpdateSchema = z.object({
  avatarUrl: z.string().trim().url().nullable().optional(),
  fullName: z.string().trim().min(1).max(160).nullable().optional(),
});
const googleCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
});

function getTokenExpiry(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function getVerificationUrl(token: string, origin: string | undefined) {
  const verificationUrl = new URL(
    '/auth/verify',
    origin ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  );
  verificationUrl.searchParams.set('token', token);

  return verificationUrl.toString();
}

function getPasswordResetUrl(token: string, origin: string | undefined) {
  const resetUrl = new URL(
    '/auth/reset-password',
    origin ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  );
  resetUrl.searchParams.set('token', token);

  return resetUrl.toString();
}

function getDashboardPath(role: 'admin' | 'instructor' | 'student') {
  switch (role) {
    case 'admin':
      return '/dashboard/admin';
    case 'instructor':
      return '/dashboard/instructor';
    case 'student':
      return '/dashboard/student';
  }
}

function parseGoogleState(state: string | undefined) {
  if (!state) {
    return {};
  }

  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as {
      next?: string;
      origin?: string;
    };
  } catch {
    return {};
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

@Injectable()
export class AuthService {
  private sendSession(
    request: Request,
    response: Response,
    session: Awaited<ReturnType<AuthService['issueSession']>>,
  ) {
    setAuthCookies(response, session.accessToken, session.refreshToken);

    const payload: AuthSessionDto = {
      accessToken: session.accessToken,
      profile: session.profile,
      ...(request.get('x-client') === 'mobile'
        ? { refreshToken: session.refreshToken }
        : {}),
    };

    return response.status(200).json(payload);
  }

  private async createVerificationToken(userId: string) {
    const token = createOpaqueToken();
    await db.insert(emailVerificationTokens).values({
      expiresAt: getTokenExpiry(24),
      tokenHash: hashActionToken(token),
      userId,
    });

    return token;
  }

  async signup(requestBody: unknown, response: Response) {
    let input: z.infer<typeof signupSchema>;

    try {
      input = signupSchema.parse(requestBody);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new HttpException(
          { message: 'Invalid request payload.', issues: error.issues },
          400,
        );
      }

      throw error;
    }

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (existingUser) {
      throw new HttpException(
        { message: 'An account with this email already exists.' },
        409,
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const createdUser = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          authProvider: 'password',
          email: input.email,
          passwordHash,
        })
        .returning();

      if (!user) {
        throw new HttpException(
          { message: 'Account could not be created.' },
          500,
        );
      }

      await tx.insert(profiles).values({
        fullName: input.fullName ?? null,
        role: 'student',
        userId: user.id,
      });

      return user;
    });

    const verificationToken = await this.createVerificationToken(
      createdUser.id,
    );

    await sendVerificationEmail({
      email: input.email,
      verificationUrl: getVerificationUrl(verificationToken, input.origin),
    });

    return response
      .status(201)
      .json({ message: 'Account created. Verify your email.' });
  }

  private async issueSession(userId: string) {
    const profile = await getProfileByUserId(userId);

    if (!profile) {
      throw new HttpException({ message: 'Profile could not be loaded.' }, 500);
    }

    const accessToken = signAccessToken({
      email: profile.email,
      profileId: profile.id,
      role: profile.role,
      sub: userId,
    });
    const refreshToken = createOpaqueToken();
    const [storedRefreshToken] = await db
      .insert(refreshTokens)
      .values({
        expiresAt: getRefreshTokenExpiresAt(),
        tokenHash: hashRefreshToken(refreshToken),
        userId,
      })
      .returning();

    if (!storedRefreshToken) {
      throw new HttpException(
        { message: 'Session could not be created.' },
        500,
      );
    }

    return {
      accessToken,
      profile: toProfileDto(profile),
      refreshToken,
    };
  }

  async login(requestBody: unknown, request: Request, response: Response) {
    let input: z.infer<typeof loginSchema>;

    try {
      input = loginSchema.parse(requestBody);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new HttpException(
          { message: 'Invalid request payload.', issues: error.issues },
          400,
        );
      }

      throw error;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (!user?.passwordHash) {
      throw new HttpException({ message: 'Invalid email or password.' }, 401);
    }

    const passwordMatches = await bcrypt.compare(
      input.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new HttpException({ message: 'Invalid email or password.' }, 401);
    }

    if (!user.emailVerifiedAt) {
      throw new HttpException(
        { message: 'Please verify your email before signing in.' },
        403,
      );
    }

    const session = await this.issueSession(user.id);

    return this.sendSession(request, response, session);
  }

  async refresh(request: Request, response: Response) {
    const refreshToken =
      request.get('x-client') === 'mobile'
        ? (z.string().min(20).safeParse(request.body?.refreshToken).data ??
          null)
        : (parseCookies(request.get('cookie'))[refreshTokenCookieName] ?? null);

    if (!refreshToken) {
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const [storedToken] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .limit(1);

    if (!storedToken || storedToken.expiresAt <= new Date()) {
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    }

    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, storedToken.id));

    const session = await this.issueSession(storedToken.userId);

    return this.sendSession(request, response, session);
  }

  async logout(request: Request, response: Response) {
    const refreshToken =
      request.get('x-client') === 'mobile'
        ? (z.string().min(20).safeParse(request.body?.refreshToken).data ??
          null)
        : (parseCookies(request.get('cookie'))[refreshTokenCookieName] ?? null);

    if (refreshToken) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)));
    }

    clearAuthCookies(response);
    return response.status(204).send();
  }

  async verifyEmail(request: Request, response: Response) {
    let token: string;

    try {
      token = z.string().min(20).parse(request.query.token);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new HttpException(
          { message: 'Invalid request payload.', issues: error.issues },
          400,
        );
      }

      throw error;
    }

    const tokenHash = hashActionToken(token);
    const [storedToken] = await db
      .select()
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.tokenHash, tokenHash),
          isNull(emailVerificationTokens.usedAt),
        ),
      )
      .limit(1);

    if (!storedToken || storedToken.expiresAt <= new Date()) {
      throw new HttpException(
        { message: 'Verification link is invalid or expired.' },
        400,
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.id, storedToken.userId));
      await tx
        .update(emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailVerificationTokens.id, storedToken.id));
    });

    return response.status(200).json({ message: 'Email verified.' });
  }

  async requestPasswordReset(requestBody: unknown, response: Response) {
    let input: z.infer<typeof resetRequestSchema>;

    try {
      input = resetRequestSchema.parse(requestBody);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new HttpException(
          { message: 'Invalid request payload.', issues: error.issues },
          400,
        );
      }

      throw error;
    }

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (user) {
      const token = createOpaqueToken();

      await db.insert(passwordResetTokens).values({
        expiresAt: getTokenExpiry(1),
        tokenHash: hashActionToken(token),
        userId: user.id,
      });
      await sendPasswordResetEmail({
        email: input.email,
        resetUrl: getPasswordResetUrl(token, input.origin),
      });
    }

    return response.status(200).json({
      message: 'If the email exists, a password reset link has been sent.',
    });
  }

  async resendVerification(requestBody: unknown, response: Response) {
    let input: z.infer<typeof resetRequestSchema>;

    try {
      input = resetRequestSchema.parse(requestBody);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new HttpException(
          { message: 'Invalid request payload.', issues: error.issues },
          400,
        );
      }

      throw error;
    }

    const [user] = await db
      .select({ emailVerifiedAt: users.emailVerifiedAt, id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (user && !user.emailVerifiedAt) {
      const token = await this.createVerificationToken(user.id);

      await sendVerificationEmail({
        email: input.email,
        verificationUrl: getVerificationUrl(token, input.origin),
      });
    }

    return response.status(200).json({
      message: 'If the email needs verification, a new link has been sent.',
    });
  }

  async confirmPasswordReset(requestBody: unknown, response: Response) {
    let input: z.infer<typeof resetConfirmSchema>;

    try {
      input = resetConfirmSchema.parse(requestBody);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new HttpException(
          { message: 'Invalid request payload.', issues: error.issues },
          400,
        );
      }

      throw error;
    }

    const tokenHash = hashActionToken(input.token);
    const [storedToken] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
        ),
      )
      .limit(1);

    if (!storedToken || storedToken.expiresAt <= new Date()) {
      throw new HttpException(
        { message: 'Password reset link is invalid or expired.' },
        400,
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ authProvider: 'password', passwordHash })
        .where(eq(users.id, storedToken.userId));
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, storedToken.id));
    });

    return response.status(200).json({ message: 'Password has been reset.' });
  }

  async updateProfile(
    request: Request,
    requestBody: unknown,
    response: Response,
  ) {
    const context = await this.getAuthenticatedContext(request);

    if (!context) {
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    }

    let input: z.infer<typeof profileUpdateSchema>;
    try {
      input = profileUpdateSchema.parse(requestBody);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new HttpException(
          { message: 'Invalid request payload.', issues: error.issues },
          400,
        );
      }

      throw error;
    }

    const [updatedProfile] = await db
      .update(profiles)
      .set({
        avatarUrl:
          input.avatarUrl === undefined
            ? context.profile.avatarUrl
            : input.avatarUrl,
        fullName:
          input.fullName === undefined
            ? context.profile.fullName
            : input.fullName,
      })
      .where(eq(profiles.userId, context.token.sub))
      .returning();

    if (!updatedProfile) {
      throw new HttpException({ message: 'Profile not found.' }, 404);
    }

    const refreshedProfile = await getProfileByUserId(context.token.sub);
    if (!refreshedProfile) {
      throw new HttpException({ message: 'Profile could not be loaded.' }, 500);
    }

    return response.status(200).json(toProfileDto(refreshedProfile));
  }

  async redirectToGoogle(request: Request, response: Response) {
    if (
      !env.GOOGLE_OAUTH_CLIENT_ID ||
      !env.GOOGLE_OAUTH_REDIRECT_URI ||
      !env.GOOGLE_OAUTH_CLIENT_SECRET
    ) {
      throw new HttpException(
        { message: 'Google OAuth is not configured.' },
        500,
      );
    }

    const state =
      typeof request.query.state === 'string' ? request.query.state : '';
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
    url.searchParams.set('redirect_uri', env.GOOGLE_OAUTH_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'select_account');

    return response.redirect(url.toString());
  }

  async googleCallback(request: Request, response: Response) {
    if (
      !env.GOOGLE_OAUTH_CLIENT_ID ||
      !env.GOOGLE_OAUTH_REDIRECT_URI ||
      !env.GOOGLE_OAUTH_CLIENT_SECRET
    ) {
      throw new HttpException(
        { message: 'Google OAuth is not configured.' },
        500,
      );
    }

    let input: z.infer<typeof googleCallbackSchema>;
    try {
      input = googleCallbackSchema.parse(request.query);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new HttpException(
          { message: 'Invalid request payload.', issues: error.issues },
          400,
        );
      }

      throw error;
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      body: new URLSearchParams({
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        code: input.code,
        grant_type: 'authorization_code',
        redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });

    if (!tokenResponse.ok) {
      throw new HttpException(
        { message: 'Google OAuth exchange failed.' },
        401,
      );
    }

    const tokenPayload = (await tokenResponse.json()) as {
      access_token?: string;
    };
    if (!tokenPayload.access_token) {
      throw new HttpException(
        { message: 'Google OAuth exchange failed.' },
        401,
      );
    }

    const profileResponse = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } },
    );
    if (!profileResponse.ok) {
      throw new HttpException(
        { message: 'Google profile lookup failed.' },
        401,
      );
    }

    const googleProfile = (await profileResponse.json()) as {
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
      sub?: string;
    };
    if (!googleProfile.email || !googleProfile.sub) {
      throw new HttpException(
        { message: 'Google profile is missing required fields.' },
        401,
      );
    }

    const email = googleProfile.email.toLowerCase();
    let user = (
      await db.select().from(users).where(eq(users.email, email)).limit(1)
    )[0];

    if (!user) {
      user = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            authProvider: 'google',
            email,
            emailVerifiedAt: googleProfile.email_verified ? new Date() : null,
            googleId: googleProfile.sub,
          })
          .returning();

        if (!created) {
          throw new HttpException(
            { message: 'Account could not be created.' },
            500,
          );
        }

        await tx.insert(profiles).values({
          avatarUrl: googleProfile.picture ?? null,
          fullName: googleProfile.name ?? null,
          role: 'student',
          userId: created.id,
        });

        return created;
      });
    } else if (!user.googleId) {
      const [updated] = await db
        .update(users)
        .set({
          authProvider: user.passwordHash ? user.authProvider : 'google',
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          googleId: googleProfile.sub,
        })
        .where(eq(users.id, user.id))
        .returning();
      user = updated ?? user;
    }

    const session = await this.issueSession(user.id);
    const state = parseGoogleState(input.state);
    const origin = state.origin ?? env.CORS_ORIGIN;
    const next =
      typeof state.next === 'string' && state.next.trim().length > 0
        ? state.next
        : getDashboardPath(session.profile.role);

    setAuthCookies(response, session.accessToken, session.refreshToken);
    return response.redirect(new URL(next, origin).toString());
  }

  private async getAuthenticatedContext(request: Request) {
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return null;
    }

    try {
      const token: AccessTokenPayload = verifyAccessToken(accessToken);
      const profile = await getProfileByUserId(token.sub);

      return profile && !profile.suspendedAt ? { profile, token } : null;
    } catch {
      return null;
    }
  }

  async getAuthenticatedProfile(request: Request) {
    return (await this.getAuthenticatedContext(request))?.profile ?? null;
  }
}
