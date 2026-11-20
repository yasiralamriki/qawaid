import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, count, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AppUser } from '../users/user.js';
import {
  auditLogs,
  registryJobs,
  tenants,
  users,
  complianceFilings,
  type ComplianceFiling,
} from '../database/schema.js';

const reviewer = alias(users, 'reviewer');
const creator = alias(users, 'creator');

export interface CreateFilingInput {
  identifierCr?: string;
  title: string;
  category: string;
  expirationDate: string;
}

export interface FilingVersionInput {
  expectedVersion: number;
}

export interface RejectFilingInput extends FilingVersionInput {
  rejectionReason: string;
}

export type UpdateFilingInput = Partial<CreateFilingInput> & FilingVersionInput;

function validateExpectedVersion(input: FilingVersionInput): number {
  if (
    !Number.isSafeInteger(input?.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    throw new BadRequestException('expectedVersion must be a positive integer');
  }
  return input.expectedVersion;
}

function parseExpirationDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(
      'Expiration date is required and must use YYYY-MM-DD',
    );
  }
  const expirationDate = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(expirationDate.getTime()) ||
    expirationDate.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Invalid expiration date');
  }
  return expirationDate;
}

@Injectable()
export class FilingsService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  async findForUser(
    user: AppUser,
    page = 1,
    limit = 20,
    view?: string,
  ): Promise<(ComplianceFiling & { assignedReviewerName: string | null; createdByName: string | null; tenantName: string | null })[]> {
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

    if (view !== undefined && view !== 'pending') {
      throw new BadRequestException('Unsupported filings view');
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
      .select({
        ...getTableColumns(complianceFilings),
        assignedReviewerName: reviewer.username,
        createdByName: creator.username,
        tenantName: tenants.name,
        verificationStatus: registryJobs.status,
        verificationAttempts: registryJobs.attempts,
        verificationError: registryJobs.lastError,
      })
      .from(complianceFilings)
      .leftJoin(reviewer, eq(complianceFilings.assignedReviewerId, reviewer.id))
      .leftJoin(creator, eq(complianceFilings.createdBy, creator.id))
      .leftJoin(tenants, eq(complianceFilings.tenantId, tenants.id))
      .leftJoin(registryJobs, eq(complianceFilings.id, registryJobs.filingId))
      .where(and(accessFilter, view === 'pending'
        ? inArray(complianceFilings.status, ['SUBMITTED', 'UNDER_REVIEW'])
        : undefined))
      .orderBy(desc(complianceFilings.createdAt), desc(complianceFilings.id))
      .limit(limit)
      .offset((page - 1) * limit);
  }

  async getAuditHistory(user: AppUser, filingId: string) {
    if (user.role !== 'SYSTEM_ADMIN' && !user.tenantId) {
      throw new ForbiddenException('A company is required');
    }

    let accessFilter: SQL | undefined;
    if (user.role === 'SUBMITTER') {
      accessFilter = and(
        eq(complianceFilings.tenantId, user.tenantId!),
        eq(complianceFilings.createdBy, user.id),
      );
    } else if (user.role === 'AUDITOR') {
      accessFilter = and(
        eq(complianceFilings.tenantId, user.tenantId!),
        inArray(complianceFilings.status, [
          'SUBMITTED',
          'UNDER_REVIEW',
          'APPROVED',
          'REJECTED',
        ]),
      );
    } else if (user.role !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException('Unsupported role');
    }

    const [filing] = await this.db
      .select({ id: complianceFilings.id })
      .from(complianceFilings)
      .where(and(eq(complianceFilings.id, filingId), accessFilter))
      .limit(1);

    if (!filing) {
      throw new ForbiddenException('Filing not found or access denied');
    }

    return this.db
      .select({ ...getTableColumns(auditLogs), actorName: users.username })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .where(eq(auditLogs.filingId, filingId))
      .orderBy(desc(auditLogs.timestamp), desc(auditLogs.id));
  }

  async updateFiling(
    user: AppUser,
    filingId: string,
    input: UpdateFilingInput,
  ): Promise<ComplianceFiling> {
    if (user.role !== 'SUBMITTER' || !user.tenantId) {
      throw new ForbiddenException(
        'Only submitters with a company can create filings',
      );
    }

    const expectedVersion = validateExpectedVersion(input);

    const [filing] = await this.db
      .select()
      .from(complianceFilings)
      .where(
        and(
          eq(complianceFilings.id, filingId),
          eq(complianceFilings.tenantId, user.tenantId),
          eq(complianceFilings.createdBy, user.id),
        ),
      )
      .limit(1);

    if (!filing) {
      throw new ForbiddenException('Filing not found or access denied');
    }

    if (filing.status !== 'DRAFT') {
      throw new BadRequestException('Illegal filing status transition');
    }
    if (filing.version !== expectedVersion) {
      throw new ConflictException(
        'This filing has changed. Refresh it before trying again.',
      );
    }

    if (
      (input.title !== undefined && typeof input.title !== 'string') ||
      (input.category !== undefined && typeof input.category !== 'string')
    ) {
      throw new BadRequestException('Title and category must be strings');
    }
    const title = (input.title ?? filing.title).trim();
    const category = (input.category ?? filing.category).trim();
    if (!title || title.length > 255 || !category || category.length > 50) {
      throw new BadRequestException('Invalid title or category');
    }
    const expirationDate =
      input.expirationDate === undefined
        ? filing.expirationDate
        : parseExpirationDate(input.expirationDate);
    const tenantId = user.tenantId;

    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(complianceFilings)
        .set({
          title,
          category,
          expirationDate,
          version: sql`${complianceFilings.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(complianceFilings.id, filing.id),
            eq(complianceFilings.tenantId, tenantId),
            eq(complianceFilings.createdBy, user.id),
            eq(complianceFilings.status, 'DRAFT'),
            eq(complianceFilings.version, expectedVersion),
          ),
        )
        .returning();

      if (!updated) {
        throw new ConflictException(
          'This filing has changed. Refresh it before trying again.',
        );
      }

      await tx.insert(auditLogs).values({
        filingId: updated.id,
        actorId: user.id,
        action: 'UPDATE_FILING',
        metadata: { before: { title: filing.title, category: filing.category, expirationDate: filing.expirationDate }, after: { title, category, expirationDate } },
      });

      return updated;
    });
  }

  async getDashboardStats(user: AppUser): Promise<{
    totalFilings: number;
    draftFilings: number;
    submittedFilings: number;
    approvedFilings: number;
    rejectedFilings: number;
  }> {
    if (user.role !== 'SYSTEM_ADMIN' && !user.tenantId) {
      throw new ForbiddenException('A company is required');
    }

    const tenantFilter = user.role === 'SYSTEM_ADMIN' ? undefined : and(
      eq(complianceFilings.tenantId, user.tenantId!),
      user.role === 'SUBMITTER' ? eq(complianceFilings.createdBy, user.id) : undefined,
      user.role === 'AUDITOR' ? inArray(complianceFilings.status, ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']) : undefined,
    );

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
    if (input?.identifierCr !== undefined && (typeof input.identifierCr !== 'string' || input.identifierCr.trim() !== user.tenantIdentifierCr)) {
      throw new BadRequestException('Company registration must match your account company');
    }
    if (submitForReview && (!user.tenantIdentifierCr || !user.tenantIdentifierCr.trim())) {
      throw new BadRequestException('Company registration is required for submission');
    }


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

    const expirationDate = parseExpirationDate(input.expirationDate);
    return this.db.transaction(async (tx) => {
      const [draft] = await tx
        .insert(complianceFilings)
        .values({
          title,
          category,
          expirationDate,
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

  async submitDraft(
    user: AppUser,
    filingId: string,
    input: FilingVersionInput,
  ): Promise<ComplianceFiling> {
    if (user.role !== 'SUBMITTER' || !user.tenantId) {
      throw new ForbiddenException(
        'Only submitters with a company can create filings',
      );
    }

    if (!user.tenantIdentifierCr?.trim()) {
      throw new BadRequestException('Company registration is required for submission');
    }

    const expectedVersion = validateExpectedVersion(input);

    const [draft] = await this.db
      .select()
      .from(complianceFilings)
      .where(
        and(
          eq(complianceFilings.id, filingId),
          eq(complianceFilings.tenantId, user.tenantId),
          eq(complianceFilings.createdBy, user.id),
        ),
      )
      .limit(1);

    if (!draft) {
      throw new ForbiddenException('Filing not found or access denied');
    }

    if (draft.status !== 'DRAFT') {
      throw new BadRequestException('Illegal filing status transition');
    }
    if (draft.version !== expectedVersion) {
      throw new ConflictException(
        'This filing has changed. Refresh it before trying again.',
      );
    }

    const tenantId = user.tenantId;

    if (
      typeof draft.title !== 'string' ||
      typeof draft?.category !== 'string'
    ) {
      throw new BadRequestException('Title and category are required');
    }

    const title = draft.title.trim();
    const category = draft.category.trim();

    if (!title || title.length > 255 || !category || category.length > 50) {
      throw new BadRequestException('Invalid title or category');
    }

    return this.db.transaction(async (tx) => {
      const [submitted] = await tx
        .update(complianceFilings)
        .set({
          status: 'SUBMITTED',
          version: sql`${complianceFilings.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(complianceFilings.id, draft.id),
            eq(complianceFilings.tenantId, tenantId),
            eq(complianceFilings.createdBy, user.id),
            eq(complianceFilings.status, 'DRAFT'),
            eq(complianceFilings.version, expectedVersion),
          ),
        )
        .returning();

      if (!submitted) {
        throw new ConflictException(
          'This filing has changed. Refresh it before trying again.',
        );
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

  async startReview(
    user: AppUser,
    filingId: string,
    input: FilingVersionInput,
  ): Promise<ComplianceFiling> {
    if (user.role !== 'AUDITOR' || !user.tenantId) {
      throw new ForbiddenException(
        'Only auditors with a company can start review for filings',
      );
    }

    const expectedVersion = validateExpectedVersion(input);

    const [filing] = await this.db
      .select()
      .from(complianceFilings)
      .where(
        and(
          eq(complianceFilings.id, filingId),
          eq(complianceFilings.tenantId, user.tenantId),
        ),
      )
      .limit(1);

    if (!filing) {
      throw new ForbiddenException('Filing not found or access denied');
    }

    if (filing.status !== 'SUBMITTED') {
      throw new BadRequestException('Illegal filing status transition');
    }
    if (filing.version !== expectedVersion) {
      throw new ConflictException(
        'This filing has changed. Refresh it before trying again.',
      );
    }

    const tenantId = user.tenantId;

    if (
      typeof filing.title !== 'string' ||
      typeof filing?.category !== 'string'
    ) {
      throw new BadRequestException('Title and category are required');
    }

    const title = filing.title.trim();
    const category = filing.category.trim();

    if (!title || title.length > 255 || !category || category.length > 50) {
      throw new BadRequestException('Invalid title or category');
    }

    return this.db.transaction(async (tx) => {
      const [underReview] = await tx
        .update(complianceFilings)
        .set({
          status: 'UNDER_REVIEW',
          assignedReviewerId: user.id,
          version: sql`${complianceFilings.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(complianceFilings.id, filing.id),
            eq(complianceFilings.tenantId, tenantId),
            eq(complianceFilings.status, 'SUBMITTED'),
            eq(complianceFilings.version, expectedVersion),
          ),
        )
        .returning();

      if (!underReview) {
        throw new ConflictException(
          'This filing has changed. Refresh it before trying again.',
        );
      }

      await tx.insert(auditLogs).values({
        filingId: underReview.id,
        actorId: user.id,
        action: 'START_REVIEW',
        previousState: 'SUBMITTED',
        newState: 'UNDER_REVIEW',
      });

      return underReview;
    });
  }

  async approveFiling(
    user: AppUser,
    filingId: string,
    input: FilingVersionInput,
  ): Promise<ComplianceFiling> {
    if (user.role !== 'AUDITOR' || !user.tenantId) {
      throw new ForbiddenException(
        'Only auditors with a company can start review for filings',
      );
    }

    const expectedVersion = validateExpectedVersion(input);

    const [filing] = await this.db
      .select()
      .from(complianceFilings)
      .where(
        and(
          eq(complianceFilings.id, filingId),
          eq(complianceFilings.tenantId, user.tenantId),
        ),
      )
      .limit(1);

    if (!filing) {
      throw new ForbiddenException('Filing not found or access denied');
    }

    if (filing.status === 'APPROVED' || filing.status === 'REJECTED') {
      throw new ConflictException('This filing already has a final verdict');
    }
    if (filing.status !== 'UNDER_REVIEW') {
      throw new BadRequestException('Illegal filing status transition');
    }
    if (filing.version !== expectedVersion) {
      throw new ConflictException(
        'This filing has changed. Refresh it before trying again.',
      );
    }

    const tenantId = user.tenantId;

    if (
      typeof filing.title !== 'string' ||
      typeof filing?.category !== 'string'
    ) {
      throw new BadRequestException('Title and category are required');
    }

    const title = filing.title.trim();
    const category = filing.category.trim();

    if (!title || title.length > 255 || !category || category.length > 50) {
      throw new BadRequestException('Invalid title or category');
    }

    return this.db.transaction(async (tx) => {
      const [approved] = await tx
        .update(complianceFilings)
        .set({
          status: 'APPROVED',
          assignedReviewerId: user.id,
          version: sql`${complianceFilings.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(complianceFilings.id, filing.id),
            eq(complianceFilings.tenantId, tenantId),
            eq(complianceFilings.status, 'UNDER_REVIEW'),
            eq(complianceFilings.version, expectedVersion),
          ),
        )
        .returning();

      if (!approved) {
        throw new ConflictException(
          'This filing has changed. Refresh it before trying again.',
        );
      }

      await tx.insert(auditLogs).values({
        filingId: approved.id,
        actorId: user.id,
        action: 'APPROVE_FILING',
        previousState: 'UNDER_REVIEW',
        newState: 'APPROVED',
      });

      await tx.insert(registryJobs).values({ filingId: approved.id }).onConflictDoNothing();

      return approved;
    });
  }

  async rejectFiling(
    user: AppUser,
    filingId: string,
    input: RejectFilingInput,
  ): Promise<ComplianceFiling> {
    if (user.role !== 'AUDITOR' || !user.tenantId) {
      throw new ForbiddenException(
        'Only auditors with a company can start review for filings',
      );
    }

    const expectedVersion = validateExpectedVersion(input);
    if (typeof input.rejectionReason !== 'string' || !input.rejectionReason.trim() || input.rejectionReason.trim().length > 2000) {
      throw new BadRequestException('Rejection reason is required and must be at most 2000 characters');
    }
    const rejectionReason = input.rejectionReason.trim();

    const [filing] = await this.db
      .select()
      .from(complianceFilings)
      .where(
        and(
          eq(complianceFilings.id, filingId),
          eq(complianceFilings.tenantId, user.tenantId),
        ),
      )
      .limit(1);

    if (!filing) {
      throw new ForbiddenException('Filing not found or access denied');
    }

    if (filing.status === 'APPROVED' || filing.status === 'REJECTED') {
      throw new ConflictException('This filing already has a final verdict');
    }
    if (filing.status !== 'UNDER_REVIEW') {
      throw new BadRequestException('Illegal filing status transition');
    }
    if (filing.version !== expectedVersion) {
      throw new ConflictException(
        'This filing has changed. Refresh it before trying again.',
      );
    }

    const tenantId = user.tenantId;

    if (
      typeof filing.title !== 'string' ||
      typeof filing?.category !== 'string'
    ) {
      throw new BadRequestException('Title and category are required');
    }

    const title = filing.title.trim();
    const category = filing.category.trim();

    if (!title || title.length > 255 || !category || category.length > 50) {
      throw new BadRequestException('Invalid title or category');
    }

    return this.db.transaction(async (tx) => {
      const [rejected] = await tx
        .update(complianceFilings)
        .set({
          status: 'REJECTED',
          rejectionReason,
          assignedReviewerId: user.id,
          version: sql`${complianceFilings.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(complianceFilings.id, filing.id),
            eq(complianceFilings.tenantId, tenantId),
            eq(complianceFilings.status, 'UNDER_REVIEW'),
            eq(complianceFilings.version, expectedVersion),
          ),
        )
        .returning();

      if (!rejected) {
        throw new ConflictException(
          'This filing has changed. Refresh it before trying again.',
        );
      }

      await tx.insert(auditLogs).values({
        filingId: rejected.id,
        actorId: user.id,
        action: 'REJECT_FILING',
        metadata: { rejectionReason },
        previousState: 'UNDER_REVIEW',
        newState: 'REJECTED',
      });

      return rejected;
    });
  }
}
