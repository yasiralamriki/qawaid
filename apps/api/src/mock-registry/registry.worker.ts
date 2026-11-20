import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { complianceFilings, registryJobs } from '../database/schema.js';

export const MAX_REGISTRY_ATTEMPTS = 4;
export function retryDelay(attempts: number): number {
  return 1000 * 2 ** (attempts - 1);
}
export function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

@Injectable()
export class RegistryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegistryWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  onModuleInit() {
    if (process.env.REGISTRY_WORKER_DISABLED === '1') return;
    this.timer = setInterval(() => {
      if (!this.running)
        this.running = this.processNext()
          .catch(() => {
            this.logger.error(
              'Registry processing failed; the durable job will be retried',
            );
          })
          .finally(() => {
            this.running = undefined;
          });
    }, 500);
    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  async processNext(): Promise<void> {
    const token = randomUUID();
    const claimed = await this.db.execute(sql`
      UPDATE registry_jobs SET status = 'PROCESSING', lease_token = ${token}::uuid,
        next_attempt_at = now() + interval '30 seconds', updated_at = now()
      WHERE filing_id = (
        SELECT filing_id FROM registry_jobs
        WHERE status IN ('PENDING', 'RETRYING', 'PROCESSING') AND next_attempt_at <= now()
        ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING filing_id, attempts`);
    const job = claimed.rows[0] as
      { filing_id: string; attempts: number } | undefined;
    if (!job) return;
    const ownership = and(
      eq(registryJobs.filingId, job.filing_id),
      eq(registryJobs.leaseToken, token),
    );
    const payload = await this.db.execute(
      sql`SELECT t.identifier_cr FROM compliance_filings f JOIN tenants t ON t.id = f.tenant_id WHERE f.id = ${job.filing_id}::uuid`,
    );
    const company = payload.rows[0] as { identifier_cr: string } | undefined;
    let retryable = true;
    try {
      if (!company) {
        retryable = false;
        throw new Error('Filing company not found');
      }
      const response = await fetch(
        `http://127.0.0.1:${process.env.PORT ?? 4000}/mock-registry/verify`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': `filing-${job.filing_id}-${job.attempts + 1}`,
          },
          body: JSON.stringify({
            filingId: job.filing_id,
            identifierCr: company.identifier_cr,
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) {
        retryable = retryableStatus(response.status);
        throw new Error(`Registry returned HTTP ${response.status}`);
      }
      const result = (await response.json()) as {
        status?: string;
        referenceId?: string;
      };
      if (
        result.status !== 'VERIFIED' ||
        typeof result.referenceId !== 'string' ||
        result.referenceId.length > 100
      ) {
        retryable = false;
        throw new Error('Invalid registry response');
      }
      await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(registryJobs)
          .set({
            status: 'VERIFIED',
            attempts: job.attempts + 1,
            referenceId: result.referenceId,
            lastError: null,
            leaseToken: null,
            updatedAt: new Date(),
          })
          .where(ownership)
          .returning();
        if (updated)
          await tx
            .update(complianceFilings)
            .set({ externalReferenceId: result.referenceId })
            .where(eq(complianceFilings.id, job.filing_id));
      });
    } catch (error) {
      const attempts = job.attempts + 1;
      const exhausted = !retryable || attempts >= MAX_REGISTRY_ATTEMPTS;
      await this.db
        .update(registryJobs)
        .set({
          status: exhausted ? 'FAILED' : 'RETRYING',
          attempts,
          nextAttemptAt: new Date(Date.now() + retryDelay(attempts)),
          leaseToken: null,
          lastError:
            error instanceof Error ? error.message : 'Registry request failed',
          updatedAt: new Date(),
        })
        .where(ownership);
    }
  }
}
