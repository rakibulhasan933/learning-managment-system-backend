import { HttpException } from '@nestjs/common';

export class HttpError extends HttpException {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super({ message }, statusCode);
  }
}
