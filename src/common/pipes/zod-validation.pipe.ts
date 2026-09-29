import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';

/** Adapter for DTOs that expose a Zod schema without coupling controllers to Zod. */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const error = result.error;
      throw new BadRequestException({
        message: 'Invalid request payload.',
        issues: error instanceof ZodError ? error.issues : undefined,
      });
    }
    return result.data;
  }
}
