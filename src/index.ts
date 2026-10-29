// Vercel detects this conventional NestJS entrypoint and manages the HTTP
// server lifecycle for the deployed function.
import { NestFactory } from '@nestjs/core';

import { createNestApplication } from './nest.js';

void NestFactory;

async function bootstrap() {
  const app = await createNestApplication();
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  await app.listen(port);
  console.info(`NestJS backend listening on port ${port}`);
}

void bootstrap().catch((error: unknown) => {
  console.error('NestJS backend failed to start', error);
  process.exitCode = 1;
});
