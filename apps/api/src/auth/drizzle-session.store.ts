import { Injectable } from '@nestjs/common';
import { AuthenticationStorage, type SessionRecord, type SessionStore } from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, lt, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { authSessions } from '../database/schema.js';

function toSession(row: typeof authSessions.$inferSelect): SessionRecord {
  return { ...row, mfa: row.mfa ?? undefined, metadata: row.metadata ?? undefined };
}

@Injectable()
export class DrizzleSessionStore implements SessionStore {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ sessions: this });
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const [row] = await this.db.select().from(authSessions).where(eq(authSessions.id, id));
    return row ? toSession(row) : undefined;
  }

  async createSession(record: SessionRecord): Promise<void> {
    await this.db.insert(authSessions).values({
      id: record.id, userId: record.userId, createdAt: record.createdAt,
      expiresAt: record.expiresAt, lastActiveAt: record.lastActiveAt,
      mfa: record.mfa, metadata: record.metadata,
    });
    await this.db.delete(authSessions).where(lte(authSessions.expiresAt, record.createdAt));
  }

  async touchSession(id: string, lastActiveAt: Date): Promise<void> {
    await this.db.update(authSessions).set({ lastActiveAt }).where(and(
      eq(authSessions.id, id), lt(authSessions.lastActiveAt, lastActiveAt),
    ));
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = await this.db.delete(authSessions).where(eq(authSessions.id, id))
      .returning({ id: authSessions.id });
    return deleted.length > 0;
  }

  async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db.select().from(authSessions).where(eq(authSessions.userId, userId));
    return rows.map(toSession);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.userId, userId));
  }
}