import { defineConfig } from 'drizzle-kit';
import { databaseUrl } from './src/database/environment.js';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  dbCredentials: { url: databaseUrl() },
  strict: true,
  verbose: true,
});
