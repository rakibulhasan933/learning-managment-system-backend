import { createDatabase } from './index.js';
import { env } from '../config/env.js';

export const databaseConnection = createDatabase(env.DATABASE_URL);
export const DATABASE = Symbol('DATABASE');

export const databaseProvider = {
  provide: DATABASE,
  useValue: databaseConnection.db,
};
