import { createNestHttpApp } from '../src/nest.js';
import type { NextFunction, Request, Response } from 'express';

let appPromise: ReturnType<typeof createNestHttpApp> | undefined;

async function handler(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  appPromise ??= createNestHttpApp();
  const app = await appPromise;

  if (request.url === '/api') {
    request.url = '/';
  } else if (request.url.startsWith('/api/')) {
    request.url = request.url.slice(4);
  }
  app(request, response, next);
}

export default handler;
