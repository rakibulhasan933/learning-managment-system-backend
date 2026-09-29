import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import type { ImageUploadResponse } from '../types/index.js';

import { AuthService } from '../auth/auth.service.js';
import {
  uploadCourseThumbnailImage,
  uploadProfileAvatarImage,
} from '../lib/supabase-storage.js';

const imageUploadSchema = z.object({
  base64: z.string().min(1),
  contentType: z.enum([
    'image/avif',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
  ]),
  fileName: z.string().trim().min(1).max(255),
  purpose: z.enum(['course_thumbnail', 'avatar']),
});

@Injectable()
export class UploadsService {
  constructor(private readonly authService: AuthService) {}

  async image(request: Request): Promise<ImageUploadResponse> {
    const profile = await this.authService.getAuthenticatedProfile(request);
    if (!profile)
      throw new HttpException({ message: 'Authentication is required.' }, 401);
    let input: z.infer<typeof imageUploadSchema>;
    try {
      input = imageUploadSchema.parse(request.body);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new HttpException(
          { message: 'Invalid request payload.', issues: error.issues },
          400,
        );
      }
      throw error;
    }
    if (input.purpose === 'course_thumbnail') {
      if (!['admin', 'instructor'].includes(profile.role)) {
        throw new HttpException({ message: 'Access denied.' }, 403);
      }
      return {
        url: await uploadCourseThumbnailImage(input),
      };
    }
    return {
      url: await uploadProfileAvatarImage(input),
    };
  }
}
