import { Controller, Get } from '@nestjs/common';
import type { ApiHealthResponse } from './types/index.js';

@Controller()
export class HealthController {
  @Get('health')
  health(): ApiHealthResponse {
    return { status: 'ok' };
  }
}
