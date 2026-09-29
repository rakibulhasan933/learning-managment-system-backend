import { databaseConnection } from '../database/database.provider.js';

export const { client: databaseClient, db } = databaseConnection;
