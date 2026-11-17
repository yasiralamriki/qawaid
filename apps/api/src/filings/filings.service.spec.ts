import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { AppUser } from '../users/user.js';
import { FilingsService } from './filings.service.js';

const user: AppUser = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'aram.submitter',
  tenantId: '22222222-2222-4222-8222-222222222222',
  tenantName: 'Aram Organics',
  role: 'SUBMITTER',
};

function setup() {
  const pool = new pg.Pool();
  const query = vi
    .spyOn(pool, 'query')
    .mockResolvedValue({ rows: [] } as never);
  const service = new FilingsService(drizzle(pool));
  return { service, query };
}

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
