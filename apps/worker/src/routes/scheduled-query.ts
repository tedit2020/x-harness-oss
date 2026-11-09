/**
 * Query parsing for GET /api/posts/scheduled (read-only).
 *
 * - No new params  -> exactly the old behaviour: status='scheduled', no LIMIT.
 * - Any of status / since / limit given -> LIMIT applies (default 100, max 200).
 * Values only ever reach SQL as binds.
 */
export const SCHEDULED_LIST_STATUSES = ['scheduled', 'posted', 'failed'] as const;
export type ScheduledListStatus = (typeof SCHEDULED_LIST_STATUSES)[number];
export const SCHEDULED_LIST_DEFAULT_LIMIT = 100;
export const SCHEDULED_LIST_MAX_LIMIT = 200;

const JST_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?\+09:00$/;

export type ScheduledListQuery = {
  status: ScheduledListStatus;
  since: string | undefined;
  limit: number | undefined;
};

export function parseScheduledListQuery(q: {
  status?: string;
  since?: string;
  limit?: string;
}): ScheduledListQuery | { error: string } {
  const hasNew = q.status !== undefined || q.since !== undefined || q.limit !== undefined;
  const status = (q.status ?? 'scheduled') as ScheduledListStatus;
  if (!SCHEDULED_LIST_STATUSES.includes(status)) {
    return { error: `status must be one of ${SCHEDULED_LIST_STATUSES.join(', ')}` };
  }
  let since: string | undefined;
  if (q.since !== undefined) {
    if (!JST_DATETIME.test(q.since)) return { error: 'since must be YYYY-MM-DDTHH:MM:SS+09:00' };
    since = q.since;
  }
  let limit: number | undefined;
  if (q.limit !== undefined) {
    if (!/^\d+$/.test(q.limit) || Number(q.limit) < 1) return { error: 'limit must be a positive integer' };
    limit = Math.min(Number(q.limit), SCHEDULED_LIST_MAX_LIMIT);
  } else if (hasNew) {
    limit = SCHEDULED_LIST_DEFAULT_LIMIT;
  }
  return { status, since, limit };
}
