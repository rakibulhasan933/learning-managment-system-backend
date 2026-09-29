import { Global, Module } from '@nestjs/common';
import { databaseProvider } from './database.provider.js';

@Global()
@Module({
  providers: [databaseProvider],
  exports: [databaseProvider],
})
export class DatabaseModule {}
