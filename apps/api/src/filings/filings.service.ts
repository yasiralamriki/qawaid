import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AppUser } from '../users/user.js';
import {
  auditLogs,
  complianceFilings,
  type ComplianceFiling,
} from '../database/schema.js';

export interface CreateFilingInput {
  title: string;
  category: string;
}

@Injectable()
export class FilingsService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  async findForUser(
    user: AppUser,
    page = 1,
    limit = 20,
  ): Promise<ComplianceFiling[]> {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger((page - 1) * limit)
    ) {
      throw new BadRequestException(
        'page must be a positive integer; limit must be between 1 and 100',
      );
    }

    let accessFilter: SQL | undefined;

    if (user.role === 'SYSTEM_ADMIN') {
      // Global read-only reporting is explicitly permitted for system admins.
      accessFilter = undefined;
    } else {
      if (!user.tenantId) {
        throw new ForbiddenException('A company is required');
      }

      const tenantFilter = eq(complianceFilings.tenantId, user.tenantId);

      if (user.role === 'SUBMITTER') {
        accessFilter = and(
          tenantFilter,
          eq(complianceFilings.createdBy, user.id),
        );
      } else if (user.role === 'AUDITOR') {
        accessFilter = and(
          tenantFilter,
          inArray(complianceFilings.status, [
            'SUBMITTED',
            'UNDER_REVIEW',
            'APPROVED',
            'REJECTED',
          ]),
        );
      } else {
        throw new ForbiddenException('Unsupported role');
      }
    }

    return this.db
      .select()
      .from(complianceFilings)
      .where(accessFilter)
      .orderBy(desc(complianceFilings.createdAt), desc(complianceFilings.id))
      .limit(limit)
      .offset((page - 1) * limit);
  }

  async getDashboardStats(user: AppUser): Promise<{
    totalFilings: number;
    draftFilings: number;
    submittedFilings: number;
    approvedFilings: number;
    rejectedFilings: number;
  }> {
    if (!user.tenantId) {
      throw new ForbiddenException('A company is required');
    }

    const tenantFilter = eq(complianceFilings.tenantId, user.tenantId);

    const [total, draft, submitted, approved, rejected] = await Promise.all([
      this.db
        .select({ count: count(complianceFilings.id) })
        .from(complianceFilings)
        .where(tenantFilter),
      this.db
        .select({ count: count(complianceFilings.id) })
        .from(complianceFilings)
        .where(and(tenantFilter, eq(complianceFilings.status, 'DRAFT'))),
      this.db
        .select({ count: count(complianceFilings.id) })
        .from(complianceFilings)
        .where(and(tenantFilter, eq(complianceFilings.status, 'SUBMITTED'))),
      this.db
        .select({ count: count(complianceFilings.id) })
        .from(complianceFilings)
        .where(and(tenantFilter, eq(complianceFilings.status, 'APPROVED'))),
      this.db
        .select({ count: count(complianceFilings.id) })
        .from(complianceFilings)
        .where(and(tenantFilter, eq(complianceFilings.status, 'REJECTED'))),
    ]);
    
    return {
      totalFilings: Number(total[0]?.count ?? 0),
      draftFilings: Number(draft[0]?.count ?? 0),
      submittedFilings: Number(submitted[0]?.count ?? 0),
      approvedFilings: Number(approved[0]?.count ?? 0),
      rejectedFilings: Number(rejected[0]?.count ?? 0),
    };
  }

  async createDraft(
    user: AppUser,
    input: CreateFilingInput,
  ): Promise<ComplianceFiling> {
    return this.createFiling(user, input, false);
  }

  async createDraftForReview(
    user: AppUser,
    input: CreateFilingInput,
  ): Promise<ComplianceFiling> {
    return this.createFiling(user, input, true);
  }

  private async createFiling(
    user: AppUser,
    input: CreateFilingInput,
    submitForReview: boolean,
  ): Promise<ComplianceFiling> {
    if (user.role !== 'SUBMITTER' || !user.tenantId) {
      throw new ForbiddenException(
        'Only submitters with a company can create filings',
      );
    }

    const tenantId = user.tenantId;

    if (
      typeof input?.title !== 'string' ||
      typeof input?.category !== 'string'
    ) {
      throw new BadRequestException('Title and category are required');
    }

    const title = input.title.trim();
    const category = input.category.trim();

    if (!title || title.length > 255 || !category || category.length > 50) {
      throw new BadRequestException('Invalid title or category');
    }

    return this.db.transaction(async (tx) => {
      const [draft] = await tx
        .insert(complianceFilings)
        .values({
          title,
          category,
          tenantId,
          createdBy: user.id,
          status: 'DRAFT',
          version: 1,
        })
        .returning();

      if (!draft) {
        throw new Error('Draft creation returned no filing');
      }

      await tx.insert(auditLogs).values({
        filingId: draft.id,
        actorId: user.id,
        action: 'CREATE_DRAFT',
        previousState: null,
        newState: 'DRAFT',
      });

      if (!submitForReview) {
        return draft;
      }

      const [submitted] = await tx
        .update(complianceFilings)
        .set({
          status: 'SUBMITTED',
          version: 2,
          updatedAt: new Date(),
        })
        .where(eq(complianceFilings.id, draft.id))
        .returning();

      if (!submitted) {
        throw new Error('Submission returned no filing');
      }

      await tx.insert(auditLogs).values({
        filingId: submitted.id,
        actorId: user.id,
        action: 'SUBMIT_FOR_REVIEW',
        previousState: 'DRAFT',
        newState: 'SUBMITTED',
      });

      return submitted;
    });
  }
}
