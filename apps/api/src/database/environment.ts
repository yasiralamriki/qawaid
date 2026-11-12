import { config } from 'dotenv';

// API scripts run from apps/api; existing environment variables take precedence.
config({ quiet: true });

export function databaseUrl(): string {
  // Compose provides separate fields so passwords are safely URL-encoded.
  if (process.env.PGHOST) {
    const url = new URL('postgresql://localhost');
    url.hostname = process.env.PGHOST;
    url.port = process.env.PGPORT ?? '5432';
    url.username = process.env.PGUSER ?? 'qawaid';
    url.password = process.env.PGPASSWORD ?? '';
    url.pathname = '/' + encodeURIComponent(process.env.PGDATABASE ?? 'qawaid');
    return url.toString();
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required. Copy apps/api/.env.example to apps/api/.env and configure PostgreSQL.');
  }
  return url;
}
