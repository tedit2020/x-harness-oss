// =============================================================================
// kuroko-sisters-bridge: Cloudflare Worker entry point
// =============================================================================
// Phase 3 カラーズ通信インフラ (5/22 アカコ誕生日完成目標) の Worker 実装。
//
// 担当:
//   - Slack Events API 受信 + HMAC SHA-256 検証 + url_verification challenge
//   - retry header 検出 + idempotent (簡易版)
//   - waitUntil 副作用非同期化 (ntfy fanout 先 → GitHub Contents API push 後)
//   - DENY_PATTERNS 2 重ガード (Worker patterns 12 件 + 患者氏名)
//
// PLAN: docs/PLAN_PHASE3_COLORS_INFRA_20260516.md §4.1
// RESEARCH: docs/RESEARCH_PHASE3_R1_CFWORKER_SLACK_EVENTS_20260516.md §2-§4
//
// 機密マスキング厳守 (feedback_external_output_masking.md):
//   - console.log に SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET / GITHUB_PAT prefix 出力禁止
//   - signature prefix (sigHeader.slice(0, 10)) は OK (検証ロジックの debug 用、機密ではない)
//   - event_id / channel ID / user ID は log OK (識別子、機密ではない)
//   - text 本文は log 禁止 (PII / token 流入リスク)
//
// 不可逆操作 (本日 5/17 実施しない、まっさん承認後実施):
//   - wrangler dev tunnel 起動 + Slack url_verification (実機)
//   - wrangler versions upload --preview-alias phase3-rc1 (preview deploy)
//   - wrangler versions deploy (本番 deploy)
//   - wrangler secret put * (まっさん作業)
// =============================================================================

import { Hono } from 'hono';
import type {
  Bindings,
  SlackEvent,
  SlackEventPayload,
  EventCallbackPayload,
  GitHubContentsGetResponse,
  DialogEventPayload,
} from './types.js';

const app = new Hono<{ Bindings: Bindings }>();

// ─────────────────────────────────────────────────────────────────────────────
// /health: ヘルスチェック (auth 不要、deploy 直後 60 分間 curl 監視で利用、R-GAP-1)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'kuroko-sisters-bridge',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// /slack/events: Slack Events API endpoint
// RESEARCH §1.1 + §2.3 流用 + v2 強化 (bitwise OR 累積形式統一)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/slack/events', async (c) => {
  // Step 1: raw body 取得 (HMAC 検証は raw bytes 必須、json() 後は再構築不可)
  const rawBody = await c.req.text();

  // Step 2: signature headers 取得 (case-insensitive、Hono は自動小文字化)
  const sigHeader = c.req.header('x-slack-signature');
  const tsHeader = c.req.header('x-slack-request-timestamp');
  if (!sigHeader || !tsHeader) {
    return c.json({ error: 'missing signature headers' }, 401);
  }

  // Step 3: timestamp 5 分以内検証 (replay attack 防止、RESEARCH §1.5)
  const nowSec = Math.floor(Date.now() / 1000);
  const reqTs = parseInt(tsHeader, 10);
  if (!Number.isFinite(reqTs) || Math.abs(nowSec - reqTs) > 300) {
    return c.json({ error: 'timestamp out of tolerance' }, 401);
  }

  // Step 4: HMAC SHA-256 検証 (crypto.subtle + bitwise OR 累積 fallback、R-GAP-2)
  const verified = await verifySlackSignature(
    rawBody,
    tsHeader,
    sigHeader,
    c.env.SLACK_SIGNING_SECRET,
  );
  if (!verified) {
    // BLOCKED log: signature prefix のみ (機密の secret prefix は出力しない、R-GAP-7 (d))
    console.warn('slack signature verify FAILED', {
      sigPrefix: sigHeader.slice(0, 10),
      tsHeader,
    });
    return c.json({ error: 'unauthorized' }, 401);
  }

  // Step 5: JSON parse (検証後)
  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  // Step 6: url_verification challenge 即返却 (1 回限り、初回 Request URL 登録時)
  if (payload.type === 'url_verification') {
    return c.json({ challenge: payload.challenge });
  }

  // Step 7: retry 重複処理回避 (簡易版: retry は ack 済として無視、RESEARCH §1.5)
  if (c.req.header('x-slack-retry-num')) {
    console.log('slack retry detected, ignoring', {
      eventId: (payload as EventCallbackPayload).event_id,
      retryNum: c.req.header('x-slack-retry-num'),
      reason: c.req.header('x-slack-retry-reason'),
    });
    return c.json({ ok: true, ignored: 'retry' });
  }

  // Step 8: event_callback の副作用は waitUntil で非同期、Worker は即 200 OK
  if (payload.type === 'event_callback') {
    c.executionCtx.waitUntil(handleEvent(payload, c.env));
  }
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// /slack/dialog: Slack dialog endpoint (Phase 3 v4 A-v3-1)
// X投稿対話フロー専用。keyword 検出 → dialog_mode=true → pushNtfyDialog() fanout。
// PLAN v4 §2.2.1-2.2.2 / feedback_system_forced_branching 連動
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 v4 A-v3-1: /slack/dialog endpoint 追加（v3 継承）
// 既存 /slack/events と /health は一切変更しない（v3 確定設計保全）。
// keyword 検出は固定リスト（LLM 判定禁止、feedback_system_forced_branching）。
// HMAC 検証・timestamp 検証は /slack/events と同一実装を踏襲。
// 詳細: docs/PLAN_PHASE3_V3_AKAKO_INFRA_BRIDGE_v4_20260520.md §2.2.2
app.post('/slack/dialog', async (c) => {
  // Step 1: raw body 取得 (HMAC 検証は raw bytes 必須、json() 後は再構築不可)
  const rawBody = await c.req.text();

  // Step 2: signature headers 取得
  const sigHeader = c.req.header('x-slack-signature');
  const tsHeader = c.req.header('x-slack-request-timestamp');
  if (!sigHeader || !tsHeader) {
    return c.json({ error: 'missing signature headers' }, 401);
  }

  // Step 3: timestamp 5 分以内検証 (replay attack 防止、/slack/events と同一実装)
  const nowSec = Math.floor(Date.now() / 1000);
  const reqTs = parseInt(tsHeader, 10);
  if (!Number.isFinite(reqTs) || Math.abs(nowSec - reqTs) > 300) {
    return c.json({ error: 'timestamp out of tolerance' }, 401);
  }

  // Step 4: HMAC SHA-256 検証 (既存 verifySlackSignature を流用、§F.1)
  const verified = await verifySlackSignature(
    rawBody,
    tsHeader,
    sigHeader,
    c.env.SLACK_SIGNING_SECRET,
  );
  if (!verified) {
    console.warn('slack dialog signature verify FAILED', {
      sigPrefix: sigHeader.slice(0, 10),
      tsHeader,
    });
    return c.json({ error: 'unauthorized' }, 401);
  }

  // Step 5: JSON parse (検証後)
  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  // Step 6: url_verification challenge 即返却 (初回 Request URL 登録時)
  if (payload.type === 'url_verification') {
    return c.json({ challenge: payload.challenge });
  }

  // Step 7: retry 重複処理回避
  if (c.req.header('x-slack-retry-num')) {
    console.log('slack dialog retry detected, ignoring', {
      eventId: (payload as EventCallbackPayload).event_id,
      retryNum: c.req.header('x-slack-retry-num'),
    });
    return c.json({ ok: true, ignored: 'retry' });
  }

  // Step 8: event_callback の副作用は waitUntil で非同期、即 200 OK 返却
  if (payload.type === 'event_callback') {
    c.executionCtx.waitUntil(handleDialogEvent(payload, c.env));
  }
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));

export default app;

// =============================================================================
// HMAC SHA-256 検証
// =============================================================================
// RESEARCH §2.3 + v2 R-GAP-2 強化:
//   - fallback は bitwise OR 累積形式統一 (早期 return ゼロ保証、constant-time)
//   - timingSafeEqual が Workers 環境に存在すれば優先
// =============================================================================
export async function verifySlackSignature(
  body: string,
  ts: string,
  sig: string,
  secret: string,
): Promise<boolean> {
  const baseString = `v0:${ts}:${body}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const macBuf = await crypto.subtle.sign('HMAC', key, enc.encode(baseString));
  const macHex =
    'v0=' +
    Array.from(new Uint8Array(macBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  // 長さ不一致時も constant-time にするため、短い方を sig に揃えてダミー比較
  // (length mismatch を漏出させない、bitwise OR 累積で早期 return ゼロ)
  if (macHex.length !== sig.length) {
    // 同じ長さで XOR 累積 (常に !== 0 で false 返却)
    const a = enc.encode(macHex);
    const b = enc.encode(macHex);
    let diff = 1; // 強制不一致
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0; // 常に false
  }

  const a = enc.encode(macHex);
  const b = enc.encode(sig);

  // timingSafeEqual が存在する Workers ランタイムなら優先 (RESEARCH §2.3)
  // 型は workers-types に未定義のため any 経由で feature detection
  const cryptoAny = crypto as unknown as {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  };
  if (typeof cryptoAny.timingSafeEqual === 'function') {
    return cryptoAny.timingSafeEqual(a, b);
  }

  // fallback: bitwise OR 累積形式統一 (R-GAP-2、早期 return ゼロ)
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// =============================================================================
// event_callback 処理 (waitUntil 内、200 OK 返却後の非同期実行)
// =============================================================================
// 優先順 (R-GAP-6): pushNtfy (即時性) → pushGitHubLog (永続性)
// Promise.race で 25 秒 hard cap (Worker default 30s tail への余裕)
// =============================================================================
async function handleEvent(
  payload: EventCallbackPayload,
  env: Bindings,
): Promise<void> {
  const ev = payload.event;
  if (!ev || ev.type !== 'message') return;

  // 無限ループ防止 (RESEARCH §7.1 #8、M-5)
  // bot_id チェック + BOT_USER_ID 一致チェックの二重防御
  // BOT_USER_ID は 5/21 夜 install 後に追記、未設定時は bot_id のみで防御
  if (ev.bot_id) return;
  if (env.BOT_USER_ID && ev.user === env.BOT_USER_ID) return;

  // edit / delete はスキップ (M-3)
  if (ev.subtype === 'message_changed' || ev.subtype === 'message_deleted') return;

  // DENY_PATTERNS 2 重ガード (Worker 側、R-GAP-11)
  // ntfy / GitHub どちらに流れる前にもここで drop
  if (containsDenyPattern(ev.text || '')) {
    console.warn('event masked by DENY pattern, dropped', {
      eventId: payload.event_id,
      channel: ev.channel,
    });
    return;
  }

  // Phase 3 v4 独自-A-1: PLAN §6.1「/slack/events は一切変更しない」制約を上書き。
  // 理由 = PLAN §2.2.1 アーキテクチャ矛盾。Slack Events API は 1 アプリ 1 request_url
  // のため、別エンドポイント /slack/dialog には message イベントが届かない
  // （manifest.yaml event_subscriptions.request_url は /slack/events のみ）。
  // → /slack/events の入口で dialog keyword 判定 → 経路分岐する案 B 方式に変更。
  // まっさん承認 2026-05-20。Evaluator High-2。
  // 詳細: docs/PLAN_PHASE3_V3_AKAKO_INFRA_BRIDGE_v4_20260520.md §0.4 / §2.2.1
  // backward compatibility: 非 dialog メッセージは従来 pushNtfy 経路を完全保全。
  if (detectDialogMode(ev.text || '')) {
    // dialog keyword 該当 → dialog fanout 経路（pushNtfyDialog 経由、dialog_mode=true）
    // DENY / bot_id / subtype チェックは上で既に通過済のため再実行しない。
    await dispatchDialogFanout(ev, payload, env);
    return;
  }

  // 非 dialog メッセージ: 従来 pushNtfy 経路（v2 設計のまま、regress なし）
  // ntfy fanout を先に走らせる (即時性、R-GAP-6)
  const ntfyJob = Promise.allSettled([
    pushNtfy(env, env.NTFY_TOPIC_KEDIT, ev, payload),
    pushNtfy(env, env.NTFY_TOPIC_BIKA, ev, payload),
    env.NTFY_TOPIC_AKAKO
      ? pushNtfy(env, env.NTFY_TOPIC_AKAKO, ev, payload)
      : Promise.resolve(),
    env.NTFY_TOPIC_BROADCAST
      ? pushNtfy(env, env.NTFY_TOPIC_BROADCAST, ev, payload)
      : Promise.resolve(),
  ]);

  // GitHub log push は 25 秒 hard cap (R-GAP-6)
  const githubJob = Promise.race<unknown>([
    pushGitHubLogWithRetry(env, ev, payload),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('github push hard cap 25s')), 25_000),
    ),
  ]).catch((e) => {
    console.warn('github push timeout or final fail', {
      eventId: payload.event_id,
      error: String(e).slice(0, 100),
    });
  });

  await Promise.allSettled([ntfyJob, githubJob]);
}

// =============================================================================
// ntfy 認証ヘッダ生成ヘルパー（案A: NTFY_TOKEN 対応）
// =============================================================================
// PLAN_BRIDGE_NTFY_AUTH_TOKEN_20260520 §6 推奨実装。
// NTFY_TOKEN が設定されていれば Bearer ヘッダを返し、未設定なら空オブジェクト（後方互換）。
// pushNtfy / pushNtfyDialog の両経路で同一ヘルパーを使うことでロジック重複ゼロを保証（§6.2）。
// 値・prefix は console.log に出力しない（feedback_external_output_masking）。
// =============================================================================
function ntfyAuthHeaders(env: Bindings): Record<string, string> {
  return env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {};
}

// =============================================================================
// ntfy.sh fanout (1 topic 1 fetch、5s timeout、失敗 silent)
// =============================================================================
// RESEARCH §3.2 流用、機密マスキング: topic は prefix 12 文字のみ log 出力
// =============================================================================
export async function pushNtfy(
  env: Bindings,
  topic: string | undefined,
  ev: SlackEvent,
  payload: EventCallbackPayload,
): Promise<void> {
  if (!topic) return;

  const channelLabel = ev.channel || '?';
  const userLabel = ev.user || '?';
  const title = `[Slack ${channelLabel}] @${userLabel}`.slice(0, 1024);
  const body = (ev.text || '').slice(0, 256);
  const click = buildSlackPermalink(payload.team_id, ev.channel || '', ev.ts || '');

  try {
    const res = await fetch(`${env.NTFY_BASE_URL}/${topic}`, {
      method: 'POST',
      headers: {
        ...ntfyAuthHeaders(env),
        Title: title,
        Priority: '3',
        Tags: 'kuroko,slack-relay',
        Click: click,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn('ntfy push non-2xx', {
        topicPrefix: topic.slice(0, 12),
        status: res.status,
      });
    }
  } catch (e) {
    console.warn('ntfy push error', {
      topicPrefix: topic.slice(0, 12),
      error: String(e).slice(0, 100),
    });
  }
}

function buildSlackPermalink(teamId: string, channel: string, _ts: string): string {
  // チャネル直リンク (簡易版、thread 直リンクは Phase 3.1 で検討)
  return `https://app.slack.com/client/${teamId}/${channel}`;
}

// =============================================================================
// GitHub Contents API push (kuroko-org colors_log/slack/YYYY-MM-DD.jsonl)
// =============================================================================
// RESEARCH §4.1 + v2 M-10/R-GAP-5 強化:
//   - 最大 2 retry (fixed delay 500ms + 1000ms、合計 1.5s 以内、waitUntil 内)
//   - SHA mismatch 検出時の最新 SHA 再取得 → 再 PUT
//   - x-ratelimit-remaining ヘッダ log 出力 (5/22 配布後 1 週間 monitoring)
//   - quota 超過時 指数バックオフ (30s / 5min / 1h) + 1h 超過時 ntfy priority 5 通知
// =============================================================================
export async function pushGitHubLogWithRetry(
  env: Bindings,
  ev: SlackEvent,
  payload: EventCallbackPayload,
  dialogMode = false,
): Promise<void> {
  const delays = [500, 1000];
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const result = await pushGitHubLog(env, ev, payload, dialogMode);
      if (result === 'ok') return;
      if (result === 'sha-conflict' && attempt < delays.length) {
        // SHA mismatch (他 commit 競合) → 最新 SHA 再取得 → 再 PUT
        await sleep(delays[attempt]);
        continue;
      }
      if (result === 'rate-limited') {
        // quota 超過: 指数バックオフ (30s / 5min / 1h)
        // waitUntil 内なので 30s で打ち切り、5min / 1h は priority 5 通知に
        console.warn('github rate limited, escalating', {
          eventId: payload.event_id,
        });
        return;
      }
      return; // other non-retryable error
    } catch (e) {
      lastError = e;
      if (attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
    }
  }

  // 最終失敗: BLOCKED 通知 (ntfy priority 5、PII 含まず eventId のみ)
  console.error('github push permanent fail', {
    eventId: payload.event_id,
    error: String(lastError).slice(0, 100),
  });
}

// Phase 3 v4 A-v3-2: pushGitHubLog() の JSONL 行に dialog_mode: boolean + thread_ts: string|null を追加
// 既存フィールド（ts/event_id/team_id/channel/user/text_len/thread_ts/channel_type）は変更なし。
// dialog_mode は新規追加フィールド（falsy なら false）。
// 詳細: docs/PLAN_PHASE3_V3_AKAKO_INFRA_BRIDGE_v4_20260520.md §2.2.2 スコープ A-v3-2
async function pushGitHubLog(
  env: Bindings,
  ev: SlackEvent,
  payload: EventCallbackPayload,
  dialogMode = false,
): Promise<'ok' | 'sha-conflict' | 'rate-limited' | 'error'> {
  const tsIso = new Date(payload.event_time * 1000).toISOString();
  const day = tsIso.slice(0, 10); // YYYY-MM-DD
  const path = `colors_log/slack/${day}.jsonl`;
  const line =
    JSON.stringify({
      ts: tsIso,
      event_id: payload.event_id,
      team_id: payload.team_id,
      channel: ev.channel,
      user: ev.user,
      text_len: (ev.text || '').length,
      thread_ts: ev.thread_ts || null,
      channel_type: ev.channel_type,
      dialog_mode: dialogMode,
    }) + '\n';

  const ghHeaders: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_PAT}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'kuroko-sisters-bridge',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Step 1: 既存 file 取得 (404 なら新規作成、その他 5xx は retry)
  const getUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`;
  let sha: string | null = null;
  let existing = '';

  const getRes = await fetch(getUrl, { headers: ghHeaders });
  logRateLimit(getRes, 'get');

  if (getRes.ok) {
    const j = (await getRes.json()) as GitHubContentsGetResponse;
    sha = j.sha;
    // base64 decode (Worker は atob 利用可、改行除去後 decode)
    existing = atob(j.content.replace(/\n/g, ''));
  } else if (getRes.status === 404) {
    // 新規作成 path、sha なしで PUT
    sha = null;
  } else if (getRes.status === 403 || getRes.status === 429) {
    return 'rate-limited';
  } else {
    console.warn('github get failed', { status: getRes.status });
    return 'error';
  }

  // Step 2: 末尾追記 → base64 encode → PUT
  const newContent = btoa(existing + line);
  const putUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const putBody: Record<string, unknown> = {
    message: `colors_log: slack event ${payload.event_id}`,
    content: newContent,
    branch: env.GITHUB_BRANCH,
  };
  if (sha) putBody.sha = sha;

  const putRes = await fetch(putUrl, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(putBody),
  });
  logRateLimit(putRes, 'put');

  if (putRes.ok) return 'ok';
  if (putRes.status === 409 || putRes.status === 422) return 'sha-conflict';
  if (putRes.status === 403 || putRes.status === 429) return 'rate-limited';

  console.warn('github put failed', {
    status: putRes.status,
    eventId: payload.event_id,
  });
  return 'error';
}

function logRateLimit(res: Response, op: 'get' | 'put'): void {
  // x-ratelimit-remaining ヘッダ log 出力 (R-GAP-5 monitoring)
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  if (remaining !== null) {
    console.log('github rate limit', { op, remaining, reset });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// =============================================================================
// /slack/dialog: dialog event 処理 (Phase 3 v4 A-v3-1 / A-v3-3)
// =============================================================================
// keyword 検出 → dialog_mode=true → pushNtfyDialog() fanout。
// DENY_PATTERNS 適用は /slack/events と同様。
// 無限ループ防止 (bot_id / BOT_USER_ID チェック) も同様。
// =============================================================================
// Phase 3 v4 A-v3-1: dialog keyword 検出用固定リスト（LLM 判定禁止）
// feedback_system_forced_branching: 重要な分岐はシステム側で強制。
// 詳細: docs/PLAN_PHASE3_V3_AKAKO_INFRA_BRIDGE_v4_20260520.md §2.2.2
const DIALOG_KEYWORDS: string[] = [
  '投稿案',
  'ネタ',
  'x-post',
  'xpost',
  'tweet',
  '@シロコ',
];

// Phase 3 v4 High-1: detectDialogMode を export 化。
// 案 B で handleEvent（/slack/events 入口）から呼ぶため export が必然。
// test/index.test.ts §3 keyword smoke も本実関数を直接 import してテストする
// （inline コピー DIALOG_KEYWORDS_TEST は廃止、Evaluator High-1）。
export function detectDialogMode(text: string): boolean {
  // Phase 3 v4 A-v3-1: keyword に1つでもマッチしたら dialog_mode=true
  // LLM 判定禁止（feedback_system_forced_branching 連動）
  const lower = text.toLowerCase();
  return DIALOG_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// =============================================================================
// dispatchDialogFanout: dialog fanout コア処理 (Phase 3 v4 A-v3-3)
// =============================================================================
// dialog keyword 該当メッセージを pushNtfyDialog() で JSON fanout する共通処理。
// handleEvent（/slack/events 入口、案 B 経路）と handleDialogEvent
// （/slack/dialog test 用エンドポイント）の両方から再利用する。
// 呼び出し側で DENY / bot_id / subtype チェックを通過済の前提。
// 詳細: docs/PLAN_PHASE3_V3_AKAKO_INFRA_BRIDGE_v4_20260520.md §2.2.2
async function dispatchDialogFanout(
  ev: SlackEvent,
  payload: EventCallbackPayload,
  env: Bindings,
): Promise<void> {
  // dialog 経路に必要なフィールドが揃わない場合は従来 pushNtfy 経路に fallback
  if (!(ev.type === 'message' && ev.text && ev.channel && ev.user && ev.ts)) {
    const fallbackNtfy = Promise.allSettled([
      pushNtfy(env, env.NTFY_TOPIC_KEDIT, ev, payload),
      pushNtfy(env, env.NTFY_TOPIC_BIKA, ev, payload),
      env.NTFY_TOPIC_AKAKO
        ? pushNtfy(env, env.NTFY_TOPIC_AKAKO, ev, payload)
        : Promise.resolve(),
      env.NTFY_TOPIC_BROADCAST
        ? pushNtfy(env, env.NTFY_TOPIC_BROADCAST, ev, payload)
        : Promise.resolve(),
    ]);
    const fallbackGithub = Promise.race<unknown>([
      pushGitHubLogWithRetry(env, ev, payload, false),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('github push hard cap 25s')), 25_000),
      ),
    ]).catch((e) => {
      console.warn('github push timeout or final fail (dialog fallback)', {
        eventId: payload.event_id,
        error: String(e).slice(0, 100),
      });
    });
    await Promise.allSettled([fallbackNtfy, fallbackGithub]);
    return;
  }

  // Phase 3 v4 A-v3-3: dialog_mode=true の場合は pushNtfyDialog() で JSON fanout
  const dialogEv: DialogEventPayload = {
    type: 'message',
    text: ev.text,
    ts: ev.ts,
    thread_ts: ev.thread_ts,
    channel: ev.channel,
    user: ev.user,
  };

  const ntfyJobs: Promise<void>[] = [];
  if (env.NTFY_TOPIC_KEDIT) ntfyJobs.push(pushNtfyDialog(env, dialogEv, env.NTFY_TOPIC_KEDIT));
  if (env.NTFY_TOPIC_BIKA) ntfyJobs.push(pushNtfyDialog(env, dialogEv, env.NTFY_TOPIC_BIKA));
  if (env.NTFY_TOPIC_AKAKO) ntfyJobs.push(pushNtfyDialog(env, dialogEv, env.NTFY_TOPIC_AKAKO));
  if (env.NTFY_TOPIC_BROADCAST) ntfyJobs.push(pushNtfyDialog(env, dialogEv, env.NTFY_TOPIC_BROADCAST));

  const githubJob = Promise.race<unknown>([
    pushGitHubLogWithRetry(env, ev, payload, true),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('github push hard cap 25s')), 25_000),
    ),
  ]).catch((e) => {
    console.warn('github push timeout or final fail (dialog)', {
      eventId: payload.event_id,
      error: String(e).slice(0, 100),
    });
  });

  await Promise.allSettled([Promise.allSettled(ntfyJobs), githubJob]);
}

// =============================================================================
// handleDialogEvent: /slack/dialog エンドポイント用（test POST 温存）
// =============================================================================
// 案 B 移行後、本番の message イベントは handleEvent（/slack/events 入口）
// 経由で dispatchDialogFanout に流れる。本関数は /slack/dialog への直接 test
// POST 用に温存（まっさん指示 2026-05-20）。
// =============================================================================
async function handleDialogEvent(
  payload: EventCallbackPayload,
  env: Bindings,
): Promise<void> {
  const ev = payload.event;
  if (!ev || ev.type !== 'message') return;

  // 無限ループ防止（/slack/events と同一実装）
  if (ev.bot_id) return;
  if (env.BOT_USER_ID && ev.user === env.BOT_USER_ID) return;

  // edit / delete はスキップ
  if (ev.subtype === 'message_changed' || ev.subtype === 'message_deleted') return;

  // DENY_PATTERNS 適用（/slack/dialog でも必ず呼び出す、A-v3-1 要件）
  if (containsDenyPattern(ev.text || '')) {
    console.warn('dialog event masked by DENY pattern, dropped', {
      eventId: payload.event_id,
      channel: ev.channel,
    });
    return;
  }

  // keyword 検出（固定リスト、LLM 判定禁止）
  if (detectDialogMode(ev.text || '')) {
    // dialog keyword 該当 → dialog fanout（pushNtfyDialog 経由）
    await dispatchDialogFanout(ev, payload, env);
  } else {
    // dialog_mode=false: 通常 ntfy fanout（non-dialog メッセージも受け付ける）
    const ntfyJob = Promise.allSettled([
      pushNtfy(env, env.NTFY_TOPIC_KEDIT, ev, payload),
      pushNtfy(env, env.NTFY_TOPIC_BIKA, ev, payload),
      env.NTFY_TOPIC_AKAKO
        ? pushNtfy(env, env.NTFY_TOPIC_AKAKO, ev, payload)
        : Promise.resolve(),
      env.NTFY_TOPIC_BROADCAST
        ? pushNtfy(env, env.NTFY_TOPIC_BROADCAST, ev, payload)
        : Promise.resolve(),
    ]);

    const githubJob = Promise.race<unknown>([
      pushGitHubLogWithRetry(env, ev, payload, false),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('github push hard cap 25s')), 25_000),
      ),
    ]).catch((e) => {
      console.warn('github push timeout or final fail (dialog non-dialog)', {
        eventId: payload.event_id,
        error: String(e).slice(0, 100),
      });
    });

    await Promise.allSettled([ntfyJob, githubJob]);
  }
}

// =============================================================================
// pushNtfyDialog: dialog 専用 ntfy push (Phase 3 v4 A-v3-3)
// =============================================================================
// Phase 3 v4 A-v3-3: dialog 専用 ntfy push（I-1 Critical 解消）
// v2 pushNtfy() は変更なし、backward compatible
// A⇔C インターフェース contract: JSON body の 5 フィールド（text/dialog_mode/
//   thread_ts/channel/user）は Implementer C receive-from-slack.sh と完全一致必須。
// 詳細: docs/PLAN_PHASE3_V3_AKAKO_INFRA_BRIDGE_v4_20260520.md §2.2.2
export async function pushNtfyDialog(
  env: Bindings,
  ev: DialogEventPayload,
  topic: string,
): Promise<void> {
  if (!topic) return;

  // A⇔C contract JSON schema（Implementer C jq parse と完全一致）:
  //   text: string, dialog_mode: true, thread_ts: string, channel: string, user: string
  const body = JSON.stringify({
    text: ev.text,
    dialog_mode: true,
    thread_ts: ev.thread_ts || ev.ts,
    channel: ev.channel,
    user: ev.user,
  });

  try {
    const res = await fetch(`${env.NTFY_BASE_URL}/${topic}`, {
      method: 'POST',
      headers: {
        ...ntfyAuthHeaders(env),
        'Content-Type': 'application/json',
        'Title': 'dialog',
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn('ntfy dialog push non-2xx', {
        topicPrefix: topic.slice(0, 12),
        status: res.status,
      });
    }
  } catch (e) {
    console.warn('ntfy dialog push error', {
      topicPrefix: topic.slice(0, 12),
      error: String(e).slice(0, 100),
    });
  }
}

// =============================================================================
// DENY_PATTERNS 2 重ガード (Worker 側)
// =============================================================================
// notify-ntfy.sh / notify-slack.sh の DENY_PATTERNS と 1:1 一致強制 (M-11, R-GAP-11)
// 共通定義は ~/.claude/scripts/common-deny-patterns.sh (Implementer C 担当 A-7)、
// Worker 側は TypeScript regex として手動転記 → phase3-smoke.sh で diff = 0 検証
//
// 12 件パターン (PLAN §4.4):
//   sk-ant- / sk_live_ / sk_test_ / xoxb- / xoxp- / xapp- / ghp_ / gho_ /
//   Bearer <40+chars> / AKIA<16> / hooks.slack.com / UUID v4
// + 患者氏名 pattern (feedback_pii_masking 連動、漢字 2-4 + 数字 3+)
// + 公式番号 080-1652-1606 whitelist (feedback_official_contact_disclosure_policy)
// =============================================================================
export function containsDenyPattern(text: string): boolean {
  if (!text) return false;

  const patterns: RegExp[] = [
    /sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{40,}/,
    /sk-ant-/,
    /sk_live_[A-Za-z0-9]{20,}/,
    /sk_test_[A-Za-z0-9]{20,}/,
    /xoxb-[0-9]{10,}-[A-Za-z0-9-]{20,}/,
    /xoxp-[0-9]{10,}-[A-Za-z0-9-]{20,}/,
    /xapp-[0-9]+-[A-Z0-9]+-[0-9]+-[a-f0-9]{40,}/,
    /ghp_[A-Za-z0-9]{36}/,
    /gho_[A-Za-z0-9]{36}/,
    /Bearer [A-Za-z0-9_+/=-]{40,}/,
    /AKIA[0-9A-Z]{16}/,
    /hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+/,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    /[一-龯]{2,4}[ 　]*[0-9]{3,}/, // 患者氏名 pattern (PII)
  ];

  // 電話番号判定: 080-1652-1606 (公式) は whitelist、それ以外の 09x/08x/07x はマッチ
  const phonePattern = /0[789]0-[0-9]{4}-[0-9]{4}/g;
  const officialPhone = '080-1652-1606';
  const phoneHits = text.match(phonePattern) || [];
  if (phoneHits.some((h) => h !== officialPhone)) return true;

  return patterns.some((p) => p.test(text));
}
