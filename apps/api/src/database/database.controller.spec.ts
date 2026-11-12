import { ServiceUnavailableException } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DatabaseController } from './database.controller.js';

describe('DatabaseController', () => {
  it('checks the database connection', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const controller = new DatabaseController({ execute } as unknown as NodePgDatabase);
    await expect(controller.database()).resolves.toEqual({ status: 'ok', database: 'postgresql' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('returns 503 without exposing connection details', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('private connection details'));
    const controller = new DatabaseController({ execute } as unknown as NodePgDatabase);
    await expect(controller.database()).rejects.toThrow(ServiceUnavailableException);
    await expect(controller.database()).rejects.toThrow('Database is unavailable');
  });
});
