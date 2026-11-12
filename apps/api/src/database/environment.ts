import { config } from 'dotenv';

// API scripts run from apps/api; existing environment variables take precedence.
config({ quiet: true });

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required. Copy apps/api/.env.example to apps/api/.env and configure PostgreSQL.');
  }
  return url;
}
