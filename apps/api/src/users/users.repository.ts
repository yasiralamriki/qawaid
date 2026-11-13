import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users } from '../database/schema.js';
import { normalizeUsername, type AppUser } from './user.js';

const publicFields = {
  id: users.id, username: users.username,
  tenantId: users.tenantId, role: users.role,
};

@Injectable()
export class UsersRepository {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  async findById(id: string): Promise<AppUser | null> {
    const [user] = await this.db.select(publicFields).from(users)
      .where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  // Internal credential lookup: never return this result from a controller.
  async findCredentials(username: string) {
    const [row] = await this.db.select({ ...publicFields, passwordHash: users.passwordHash })
      .from(users).where(eq(users.username, normalizeUsername(username))).limit(1);
    if (!row) return null;
    const { passwordHash, ...user } = row;
    return { user, passwordHash };
  }
}