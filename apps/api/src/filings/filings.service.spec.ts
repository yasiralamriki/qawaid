import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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
