import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { optionalAuth } from './auth.js';

/**
 * Resolves the optional backend session once per request and stores it on
 * Express' request object for Nest guards and services to consume.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    return optionalAuth(request, response, next);
  }
}
