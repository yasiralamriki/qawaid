import { databaseUrl } from './environment.js';

describe('databaseUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the host connection URL outside Docker', () => {
    vi.stubEnv('PGHOST', '');
    vi.stubEnv('DATABASE_URL', 'postgresql://local:password@127.0.0.1:5432/qawaid');
    expect(databaseUrl()).toBe('postgresql://local:password@127.0.0.1:5432/qawaid');
  });

  it('uses the Compose hostname and safely encodes credentials', () => {
    vi.stubEnv('PGHOST', 'postgres');
    vi.stubEnv('PGPORT', '5432');
    vi.stubEnv('PGUSER', 'qawaid');
    vi.stubEnv('PGPASSWORD', 'p@ss:/?#word');
    vi.stubEnv('PGDATABASE', 'qawaid');
    vi.stubEnv('DATABASE_URL', 'postgresql://wrong-host');
    const url = new URL(databaseUrl());
    expect(url.hostname).toBe('postgres');
    expect(url.port).toBe('5432');
    expect(decodeURIComponent(url.password)).toBe('p@ss:/?#word');
    expect(url.pathname).toBe('/qawaid');
  });

  it('reports missing configuration', () => {
    vi.stubEnv('PGHOST', '');
    vi.stubEnv('DATABASE_URL', '');
    expect(() => databaseUrl()).toThrow('DATABASE_URL is required');
  });
});
