import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const isHttpException = error instanceof HttpException;
    const status = isHttpException
      ? error.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttpException
      ? error.getResponse()
      : { message: 'Internal server error.' };

    if (!isHttpException || status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    response.status(status).json(payload);
  }
}
