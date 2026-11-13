import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Public } from '@nestjs/authentication';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

@Controller('health')
export class DatabaseController {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  @Public()
  @Get('database')
  async database() {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', database: 'postgresql' };
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
  }
}
