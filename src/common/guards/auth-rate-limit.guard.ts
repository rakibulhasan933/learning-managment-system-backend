import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

// Simple in-memory rate limiter for auth endpoints only. No new
// dependency, no persistence: counters live in this process and reset on
// restart. That is deliberate — it stops casual credential stuffing and
// reset-mail abuse without adding infrastructure. On a multi-instance
// deployment it limits per instance, not globally.
const WINDOW_MS = 15 * 60 * 1000;

// Attempts allowed per key within one window, by route.
const LIMITS: Array<{ limit: number; path: RegExp }> = [
  { limit: 10, path: /^\/auth\/(login|signup)$/ },
  {
    limit: 5,
    path: /^\/auth\/(password-reset\/(request|confirm)|verification\/resend)$/,
  },
];

// key -> attempt timestamps (ms). Pruned on every check.
const attempts = new Map<string, number[]>();

function routeLimit(path: string): number {
  for (const entry of LIMITS) {
    if (entry.path.test(path)) return entry.limit;
  }
  return Infinity;
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // Nest strips the '/api' prefix before routing in this app, so the
    // path seen here is the route path (e.g. '/auth/login').
    const limit = routeLimit(request.path);
    if (!Number.isFinite(limit)) return true;

    const body = request.body as { email?: unknown } | undefined;
    const email =
      typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    // Key on IP + email: one account cannot be hammered from many IPs
    // without also tripping the per-email bucket, and one IP cannot lock
    // out unrelated accounts. Only the email string is kept, never a
    // password or token.
    const key = `${request.ip ?? 'unknown'}:${email || '-'}`;
    const now = Date.now();
    const recent = (attempts.get(key) ?? []).filter(
      (timestamp) => now - timestamp < WINDOW_MS,
    );
    if (recent.length >= limit) {
      throw new HttpException(
        { message: 'Too many attempts. Please try again later.' },
        429,
      );
    }
    recent.push(now);
    attempts.set(key, recent);
    return true;
  }
}
