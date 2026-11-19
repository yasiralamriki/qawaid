import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { getTableColumns } from 'drizzle-orm';
import { auditLogs, complianceFilings } from '../database/schema.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { AppUser } from '../users/user.js';
import { FilingsService } from './filings.service.js';

const user: AppUser = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'aram.submitter',
  tenantId: '22222222-2222-4222-8222-222222222222',
  tenantName: 'Aram Organics',
  tenantIdentifierCr: null,
  role: 'SUBMITTER',
};

function setup() {
  const pool = new pg.Pool();
  const query = vi
    .spyOn(pool, 'query')
    .mockResolvedValue({ rows: [] } as never);
  const db = drizzle(pool);
  const service = new FilingsService(db);
  return { service, query, db };
}

describe('Filing audit history', () => {
  const filingId = '33333333-3333-4333-8333-333333333333';

  it('rejects users without a company before querying', async () => {
    const { service, query } = setup();
    await expect(service.getAuditHistory({ ...user, tenantId: null }, filingId))
      .rejects.toThrow(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not load history for a filing outside the company', async () => {
    const { service, query } = setup();
    await expect(service.getAuditHistory(user, filingId)).rejects.toThrow(ForbiddenException);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('"tenant_id" = $2'),
    }), [filingId, user.tenantId, user.id, 1]);
  });

  it('loads history after checking company access', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce({ rows: [[filingId]] } as never);
    await expect(service.getAuditHistory(user, filingId)).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({
      text: expect.stringContaining('"audit_logs"."filing_id" = $1'),
    }), [filingId]);
  });

  it('allows auditors to read company history without requiring ownership', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce({ rows: [[filingId]] } as never);
    await expect(service.getAuditHistory({ ...user, role: 'AUDITOR' }, filingId)).resolves.toEqual([]);
    const [statement, parameters] = query.mock.calls[0];
    expect(statement).toEqual(expect.objectContaining({
      text: expect.stringContaining('"tenant_id" = $2'),
    }));
    expect(statement).toEqual(expect.objectContaining({
      text: expect.not.stringContaining('"created_by"'),
    }));
    expect(parameters).toEqual([filingId, user.tenantId, 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 1]);
  });

  it('denies auditors access to drafts and other companies before loading events', async () => {
    const { service, query } = setup();
    await expect(service.getAuditHistory({ ...user, role: 'AUDITOR' }, filingId)).rejects.toThrow(ForbiddenException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('allows administrators to read history without a company', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce({ rows: [[filingId]] } as never);
    await expect(service.getAuditHistory({ ...user, role: 'SYSTEM_ADMIN', tenantId: null }, filingId)).resolves.toEqual([]);
    expect(query.mock.calls[0][1]).toEqual([filingId, 1]);
  });
});

describe('Filing display names', () => {
  it('returns reviewer and creator names without exposing account credentials', async () => {
    const { service, query } = setup();
    const filing = { id: 'filing-id', assignedReviewerId: 'reviewer-id' };
    query.mockResolvedValueOnce({ rows: [[
      ...Object.keys(getTableColumns(complianceFilings)).map((key) => filing[key as keyof typeof filing] ?? null),
      'company.auditor', 'company.submitter',
    ]] } as never);

    await expect(service.findForUser(user)).resolves.toEqual([
      expect.objectContaining({ assignedReviewerName: 'company.auditor', createdByName: 'company.submitter' }),
    ]);
    const statement = query.mock.calls[0][0] as { text: string };
    expect(statement.text).toContain('left join "users" "reviewer"');
    expect(statement.text).toContain('left join "users" "creator"');
    expect(statement.text).not.toContain('password_hash');
  });

  it('returns actor names for audit history after checking access', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce({ rows: [['filing-id']] } as never);
    query.mockResolvedValueOnce({ rows: [[
      ...Object.keys(getTableColumns(auditLogs)).map((key) => key === 'actorId' ? 'reviewer-id' : null),
      'company.auditor',
    ]] } as never);

    await expect(service.getAuditHistory(user, 'filing-id')).resolves.toEqual([
      expect.objectContaining({ actorId: 'reviewer-id', actorName: 'company.auditor' }),
    ]);
    const statement = query.mock.calls[1][0] as { text: string };
    expect(statement.text).not.toContain('password_hash');
  });
});

describe('Filing expiration dates', () => {
  it.each([
    ['2028-02-29', '2028-02-29T00:00:00.000Z'],
  ])('stores %s as a UTC date', async (input, expected) => {
    const { service, db } = setup();
    const values = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'filing-id' }]),
    });
    const tx = { insert: vi.fn().mockReturnValue({ values }) };
    vi.spyOn(db, 'transaction').mockImplementation(async (callback) => callback(tx as never));

    await service.createDraft(user, {
      title: 'License renewal', category: 'License', expirationDate: input,
    });

    expect(values.mock.calls[0][0].expirationDate).toEqual(
      expected ? new Date(expected) : null,
    );
  });

  it.each(['2026-02-30', '2026-13-01', '18/11/2026', '2026-11-18T00:00:00Z', '', null, undefined, 20261118, {}, []]) (
    'rejects invalid date %s before writing', async (expirationDate) => {
      const { service, db } = setup();
      const transaction = vi.spyOn(db, 'transaction');
      await expect(service.createDraft(user, {
        // Simulate untrusted JSON bodies that bypass the TypeScript input type.
        title: 'License renewal', category: 'License', expirationDate: expirationDate as string,
      })).rejects.toThrow(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});

describe('FilingsService access restrictions', () => {
  it('limits submitters by both company and creator in SQL', async () => {
    const { service, query } = setup();
    await expect(service.findForUser(user)).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          '"tenant_id" = $1 and "compliance_filings"."created_by" = $2',
        ),
      }),
      [user.tenantId, user.id, 20],
    );
  });

  it('limits auditors to their company and submitted or completed filings', async () => {
    const { service, query } = setup();
    await service.findForUser({ ...user, role: 'AUDITOR' });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('"status" in') }),
      [user.tenantId, 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 20],
    );
  });

  it('allows bounded global reporting for a tenant-less system admin', async () => {
    const { service, query } = setup();
    await service.findForUser({
      ...user,
      role: 'SYSTEM_ADMIN',
      tenantId: null,
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.not.stringContaining(' where ') }),
      [20],
    );
  });

  it('does not query when an ordinary user has no company', async () => {
    const { service, query } = setup();
    await expect(
      service.findForUser({ ...user, tenantId: null }),
    ).rejects.toThrow(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('applies pagination while preserving submitter access restrictions', async () => {
    const { service, query } = setup();
    await service.findForUser(user, 3, 10);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('limit $3 offset $4'),
      }),
      [user.tenantId, user.id, 10, 20],
    );
  });

  it.each([
    [0, 20],
    [1.5, 20],
    [1, 0],
    [1, 101],
    [1, 1.5],
    [Number.MAX_SAFE_INTEGER, 100],
  ])(
    'rejects invalid pagination (%s, %s) before querying',
    async (page, limit) => {
      const { service, query } = setup();
      await expect(service.findForUser(user, page, limit)).rejects.toThrow(
        BadRequestException,
      );
      expect(query).not.toHaveBeenCalled();
    },
  );
});

describe('Draft version conflicts', () => {
  const filing = {
    id: '33333333-3333-4333-8333-333333333333',
    tenantId: user.tenantId,
    createdBy: user.id,
    title: 'License renewal',
    category: 'License',
    expirationDate: new Date('2026-12-31T00:00:00Z'),
    status: 'DRAFT',
    version: 4,
  };

  function draftSetup() {
    const context = setup();
    vi.spyOn(context.db, 'select').mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [filing] }) }),
    } as never);
    vi.spyOn(context.db, 'transaction').mockImplementation(async (callback) =>
      callback(context.db as never),
    );
    return context;
  }

  it.each(['edit', 'submit'])('rejects invalid versions before querying on %s', async (action) => {
    const { service, query } = setup();
    const input = { expectedVersion: 0 };
    const request = action === 'edit'
      ? service.updateFiling(user, filing.id, input)
      : service.submitDraft(user, filing.id, input);
    await expect(request).rejects.toThrow(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['edit', 'submit'])('rejects a stale browser version before writing on %s', async (action) => {
    const { service, db } = draftSetup();
    const input = { expectedVersion: 3 };
    const request = action === 'edit'
      ? service.updateFiling(user, filing.id, input)
      : service.submitDraft(user, filing.id, input);
    await expect(request).rejects.toThrow(ConflictException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each(['edit', 'submit'])('guards the SQL update and records no audit when a concurrent request wins on %s', async (action) => {
    const { service, query } = draftSetup();
    const input = { expectedVersion: 4 };
    const request = action === 'edit'
      ? service.updateFiling(user, filing.id, input)
      : service.submitDraft(user, filing.id, input);
    await expect(request).rejects.toThrow(ConflictException);
    expect(query).toHaveBeenCalledTimes(1);
    const [config, parameters] = query.mock.calls[0];
    const text = (config as unknown as { text: string }).text;
    const where = text.split(' where ')[1].split(' returning ')[0];
    for (const column of ['id', 'tenant_id', 'created_by', 'status', 'version']) {
      expect(where).toContain(`"compliance_filings"."${column}" =`);
    }
    expect(text).toContain('"version" + 1');
    expect(parameters).toEqual(expect.arrayContaining([
      filing.id, user.tenantId, user.id, 'DRAFT', 4,
    ]));
  });
});


describe('Starting a review', () => {
  const auditor: AppUser = { ...user, id: '44444444-4444-4444-8444-444444444444', role: 'AUDITOR' };
  const filing = { id: '33333333-3333-4333-8333-333333333333', tenantId: user.tenantId,
    createdBy: user.id, title: 'License renewal', category: 'License', status: 'SUBMITTED', version: 4 };

  function reviewSetup() {
    const context = setup();
    vi.spyOn(context.db, 'select').mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [filing] }) }),
    } as never);
    vi.spyOn(context.db, 'transaction').mockImplementation(async (callback) => callback(context.db as never));
    return context;
  }

  it('allows a different auditor to claim a submitted filing and records the transition', async () => {
    const { service, query } = reviewSetup();
    const updated = { ...filing, status: 'UNDER_REVIEW', version: 5, assignedReviewerId: auditor.id };
    query.mockResolvedValueOnce({ rows: [[filing.id, filing.tenantId, filing.title, filing.category, 'UNDER_REVIEW', 5, auditor.id, null, null, filing.createdBy, null, null, null]] } as never);
    await expect(service.startReview(auditor, filing.id, { expectedVersion: 4 })).resolves.toMatchObject(updated);
    const [config, parameters] = query.mock.calls[0];
    const sql = (config as unknown as { text: string }).text;
    const where = sql.split(' where ')[1].split(' returning ')[0];
    expect(where).not.toContain('created_by');
    for (const column of ['id', 'tenant_id', 'status', 'version']) {
      expect(where).toContain(`"compliance_filings"."${column}" =`);
    }
    expect(sql).toContain('"assigned_reviewer_id" =');
    expect(parameters).toEqual(expect.arrayContaining([auditor.id, 'UNDER_REVIEW', 'SUBMITTED', 4]));
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining(['START_REVIEW', 'SUBMITTED', 'UNDER_REVIEW']));
  });

  it('rejects stale versions before writing', async () => {
    const { service, db } = reviewSetup();
    await expect(service.startReview(auditor, filing.id, { expectedVersion: 3 })).rejects.toThrow(ConflictException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('records no audit event when another reviewer wins the update', async () => {
    const { service, query } = reviewSetup();
    await expect(service.startReview(auditor, filing.id, { expectedVersion: 4 })).rejects.toThrow(ConflictException);
    expect(query).toHaveBeenCalledTimes(1);
  });
});


describe.each([
  ['approveFiling', 'APPROVED', 'APPROVE_FILING'],
  ['rejectFiling', 'REJECTED', 'REJECT_FILING'],
] as const)('%s decisions', (method, status, action) => {
  const auditor: AppUser = { ...user, role: 'AUDITOR' };
  const filing = { id: '33333333-3333-4333-8333-333333333333', tenantId: user.tenantId,
    title: 'License renewal', category: 'License', status: 'UNDER_REVIEW', version: 4 };
  function decisionSetup(current = filing) {
    const context = setup();
    vi.spyOn(context.db, 'select').mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [current] }) }),
    } as never);
    vi.spyOn(context.db, 'transaction').mockImplementation(async (callback) => callback(context.db as never));
    return context;
  }

  it('transitions an under-review filing and records its audit event', async () => {
    const { service, query } = decisionSetup();
    query.mockResolvedValueOnce({ rows: [[filing.id, filing.tenantId, filing.title, filing.category,
      status, 5, auditor.id, null, null, user.id, null, null, null]] } as never);
    await expect(service[method](auditor, filing.id, { expectedVersion: 4 })).resolves.toMatchObject({ status, version: 5 });
    const [config, parameters] = query.mock.calls[0];
    const sql = (config as unknown as { text: string }).text;
    const where = sql.split(' where ')[1].split(' returning ')[0];
    for (const column of ['id', 'tenant_id', 'status', 'version']) {
      expect(where).toContain(`"compliance_filings"."${column}" =`);
    }
    expect(parameters).toEqual(expect.arrayContaining([filing.id, auditor.tenantId, status, 'UNDER_REVIEW', 4]));
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining([action, 'UNDER_REVIEW', status]));
  });

  it('rejects stale versions without writing', async () => {
    const { service, db } = decisionSetup();
    await expect(service[method](auditor, filing.id, { expectedVersion: 3 })).rejects.toThrow(ConflictException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a decision on a completed filing', async () => {
    const { service, db } = decisionSetup({ ...filing, status: 'APPROVED' });
    await expect(service[method](auditor, filing.id, { expectedVersion: 4 })).rejects.toThrow(ConflictException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('records no audit event when a concurrent decision wins', async () => {
    const { service, query } = decisionSetup();
    await expect(service[method](auditor, filing.id, { expectedVersion: 4 })).rejects.toThrow(ConflictException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('denies submitters before querying', async () => {
    const { service, query } = setup();
    await expect(service[method](user, filing.id, { expectedVersion: 4 })).rejects.toThrow(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });
});
