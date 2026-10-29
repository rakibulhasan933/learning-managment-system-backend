import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';

import { AppModule } from './app.module.js';
import { env } from './config/env.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor.js';

export async function createNestApplication() {
  const nestApp = await NestFactory.create(AppModule, {
    bodyParser: true,
    cors: false,
  });
  const allowedOrigins = new Set([
    ...env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  nestApp.enableCors({
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by CORS.'));
    },
  });
  nestApp.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidUnknownValues: false,
    }),
  );
  nestApp.useGlobalFilters(new HttpExceptionFilter());
  nestApp.useGlobalInterceptors(new RequestLoggingInterceptor());

  // Preserve the raw multipart body for the question-bank CSV import.
  // JSON parsing must not consume it first (no multer dependency exists).
  nestApp.use(
    '/instructor/question-bank',
    (request: Request, response: Response, next: NextFunction) => {
      if (request.path === '/import') {
        return express.raw({ limit: '5mb', type: () => true })(
          request,
          response,
          next,
        );
      }
      return next();
    },
  );

  // Preserve binary material uploads for the Nest content controller. JSON
  // parsing must not consume these PDF/slide request bodies first.
  nestApp.use(
    '/instructor/courses',
    (request: Request, response: Response, next: NextFunction) => {
      if (
        request.path.match(
          /^\/[^/]+\/(?:videos|modules|lectures)\/[^/]+\/(?:material-upload|video-upload)$/,
        )
      ) {
        return express.raw({ limit: '30mb', type: () => true })(
          request,
          response,
          next,
        );
      }
      return next();
    },
  );

  await nestApp.init();

  return nestApp;
}

export async function createNestHttpApp(): Promise<Express> {
  const nestApp = await createNestApplication();

  return nestApp.getHttpAdapter().getInstance() as Express;
}
