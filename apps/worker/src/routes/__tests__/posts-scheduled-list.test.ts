import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { posts } from '../posts.js';
import { parseScheduledListQuery } from '../scheduled-query.js';

/**
 * GET /api/posts/scheduled — read-only filter (kawaraban plan v1.2 §4.4).
 * Default (no new params) must behave exactly as before: status='scheduled', no LIMIT.
 * Cron, guards and the schedule route are not touched.
 */

type Captured = { sql: string; binds: unknown[] };

function fakeDb(rows: unknown[] = []) {
  const calls: Captured[] = [];
  const db = {
    prepare(sql: string) {
      const call: Captured = { sql, binds: [] };
      calls.push(call);
      const stmt = {
        bind(...b: unknown[]) {
          call.binds = b;
          return stmt;
        },
        async all() {
          return { results: rows, success: true, meta: {} };
        },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, calls };
}

function appWith(db: D1Database) {
  const app = new Hono();
  app.route('/', posts as unknown as Hono);
  return { app, env: { DB: db } };
}

describe('parseScheduledListQuery', () => {
  it('no params = the old behaviour (scheduled, no limit)', () => {
    expect(parseScheduledListQuery({})).toEqual({ status: 'scheduled', since: undefined, limit: undefined });
  });
  it('status can be posted / failed / scheduled', () => {
    for (const s of ['scheduled', 'posted', 'failed']) {
      expect(parseScheduledListQuery({ status: s })).toMatchObject({ status: s, limit: 100 });
    }
  });
  it('unknown status is refused', () => {
    expect(parseScheduledListQuery({ status: 'deleted' })).toHaveProperty('error');
    expect(parseScheduledListQuery({ status: "scheduled' OR 1=1" })).toHaveProperty('error');
  });
  it('limit: default 100 when any new param is given, max 200, positive integers only', () => {
    expect(parseScheduledListQuery({ limit: '5' })).toMatchObject({ limit: 5 });
    expect(parseScheduledListQuery({ limit: '999' })).toMatchObject({ limit: 200 });
    expect(parseScheduledListQuery({ limit: '0' })).toHaveProperty('error');
    expect(parseScheduledListQuery({ limit: '-1' })).toHaveProperty('error');
    expect(parseScheduledListQuery({ limit: 'abc' })).toHaveProperty('error');
    expect(parseScheduledListQuery({ since: '2026-11-01T00:00:00+09:00' })).toMatchObject({ limit: 100 });
  });
  it('since must be a JST datetime (+09:00)', () => {
    expect(parseScheduledListQuery({ since: '2026-11-01T00:00:00+09:00' })).toMatchObject({ since: '2026-11-01T00:00:00+09:00' });
    expect(parseScheduledListQuery({ since: '2026-11-01T00:00:00Z' })).toHaveProperty('error');
    expect(parseScheduledListQuery({ since: 'yesterday' })).toHaveProperty('error');
  });
});

describe('GET /api/posts/scheduled', () => {
  it('without params: same SQL as before (status=scheduled, no LIMIT)', async () => {
    const { db, calls } = fakeDb([]);
    const { app, env } = appWith(db);
    const res = await app.request('/api/posts/scheduled', {}, env);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('status = ?');
    expect(calls[0].sql).not.toContain('LIMIT');
    expect(calls[0].binds).toEqual(['scheduled']);
  });

  it('status=failed&since=&limit= is passed as binds, never into the SQL text', async () => {
    const { db, calls } = fakeDb([]);
    const { app, env } = appWith(db);
    const since = '2026-11-01T00:00:00+09:00';
    const res = await app.request(`/api/posts/scheduled?status=failed&since=${encodeURIComponent(since)}&limit=7`, {}, env);
    expect(res.status).toBe(200);
    expect(calls[0].sql).toContain('scheduled_at >= ?');
    expect(calls[0].sql).toContain('LIMIT ?');
    expect(calls[0].sql).not.toContain('failed');
    expect(calls[0].binds).toEqual(['failed', since, 7]);
  });

  it('xAccountId still works together with status', async () => {
    const { db, calls } = fakeDb([]);
    const { app, env } = appWith(db);
    await app.request('/api/posts/scheduled?status=posted&xAccountId=acc-1', {}, env);
    expect(calls[0].binds).toEqual(['posted', 'acc-1', 100]);
  });

  it('a bad status is 400 and reads nothing', async () => {
    const { db, calls } = fakeDb([]);
    const { app, env } = appWith(db);
    const res = await app.request('/api/posts/scheduled?status=nope', {}, env);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rows keep every old field and add updatedAt (the time a post went out)', async () => {
    const { db } = fakeDb([
      { id: 'p1', x_account_id: 'a', text: 'hi', media_ids: null, scheduled_at: '2026-11-09T10:00:00+09:00', status: 'posted', posted_tweet_id: '1', created_at: 'c', updated_at: 'u' },
    ]);
    const { app, env } = appWith(db);
    const res = await app.request('/api/posts/scheduled?status=posted', {}, env);
    const j = (await res.json()) as { data: Record<string, unknown>[] };
    expect(j.data[0]).toEqual({
      id: 'p1', xAccountId: 'a', text: 'hi', mediaIds: null, scheduledAt: '2026-11-09T10:00:00+09:00',
      status: 'posted', postedTweetId: '1', createdAt: 'c', updatedAt: 'u',
    });
  });
});
