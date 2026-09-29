// Keep the Nest import visible to Vercel's NestJS entrypoint detector.
import { NestFactory } from '@nestjs/core';
import { env } from './config/env.js';
import { createNestHttpApp } from './nest.js';

void NestFactory;

const app = await createNestHttpApp();
const server = app.listen(env.PORT, () => {
  console.info(`NestJS backend listening on port ${env.PORT}`);
});

function shutdown(signal: NodeJS.Signals) {
  server.close((error) => {
    if (error) {
      console.error(`${signal}: failed to close backend server`, error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
