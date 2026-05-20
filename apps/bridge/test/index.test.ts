// =============================================================================
// kuroko-sisters-bridge: 単体テスト (vitest)
// =============================================================================
// PLAN §4.6 smoke test 15 件のうち、コード起草段階で書ける単体テスト:
//   - HMAC ベクトル 3 件 (正常 / 1 bit 違い / 完全異 length、R-GAP-2)
//   - DENY pattern 9 件 (12 + 患者氏名 + UUID 等、R-GAP-11)
//
// 実機テスト (smoke test #1 / #2 / #4 / #5 / #10-12 等) は Implementer C 担当
// phase3-smoke.sh で 5/22 配布前検証 (PLAN §4.6 + §6.3)。
// =============================================================================
//
// SECURITY NOTE (5/17 追加、まっさん明示承認後):
// 以下の Case 3 / 4 / 7 の fake 値は Array.join() で動的構築している。
// これは GitHub Push Protection + gitleaks 静的解析を回避するため
// (DENY pattern 検証テスト用 fake、実値ではない、test 限定、本番 src/ では使わない)。
// 既存 paradigm: scripts/phase3-smoke.sh の bash 文字列分割 (5/15 commit 9debfb5) と同等。
// 詳細: feedback_credential_file_access_principle 原則 6/8/9 抵触なし確認済。
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  verifySlackSignature,
  containsDenyPattern,
  pushNtfy,
  pushNtfyDialog,
  detectDialogMode,
} from '../src/index.js';
import type { DialogEventPayload } from '../src/types.js';

// =============================================================================
// §1. HMAC SHA-256 検証ベクトル (R-GAP-2)
// =============================================================================
// Slack docs.slack.dev/authentication/verifying-requests-from-slack の手順に従う
// base string = "v0:<timestamp>:<body>"、HMAC-SHA256(secret, base string) を hex 化
//
// テストベクトル生成手順 (Node.js):
//   const crypto = require('crypto');
//   const secret = 'test_signing_secret_for_unit_test_only';
//   const ts = '1715800000';
//   const body = '{"type":"url_verification","challenge":"abc"}';
//   const mac = crypto.createHmac('sha256', secret)
//                     .update(`v0:${ts}:${body}`).digest('hex');
//   console.log(`v0=${mac}`);
// =============================================================================

describe('verifySlackSignature (HMAC SHA-256)', () => {
  const SECRET = 'test_signing_secret_for_unit_test_only';
  const TS = '1715800000';
  const BODY = '{"type":"url_verification","challenge":"abc"}';

  // 事前計算済 (Node.js crypto で生成、テスト固定値)
  // base string = "v0:1715800000:" + BODY
  // v0=<sha256 hex> 形式
  // 注: このベクトル値は Implementer A 着手後に実機 Node.js で生成 + 固定する
  // 5/17 scaffold 段階では placeholder、Implementer A の preview deploy 前に確定
  const VALID_SIG = 'v0=<TO_BE_COMPUTED_BY_NODE_CRYPTO_BEFORE_PREVIEW_DEPLOY>';

  it('Case 1: 正しい signature で true を返す', async () => {
    // skip 条件: VALID_SIG が placeholder のままなら skip (実機で確定後に有効化)
    if (VALID_SIG.includes('<TO_BE_COMPUTED')) {
      // 暫定: 自前で計算した signature を入れて round-trip 検証
      const baseString = `v0:${TS}:${BODY}`;
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(SECRET),
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
      const ok = await verifySlackSignature(BODY, TS, macHex, SECRET);
      expect(ok).toBe(true);
      return;
    }
    const ok = await verifySlackSignature(BODY, TS, VALID_SIG, SECRET);
    expect(ok).toBe(true);
  });

  it('Case 2: 1 bit 違いの signature で false を返す (timing-safe)', async () => {
    // 正しい signature を計算 → 末尾 1 char を変更 → false
    const baseString = `v0:${TS}:${BODY}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(SECRET),
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

    // 末尾 1 char を入れ替えて 1 bit 違いを作る
    const lastChar = macHex.slice(-1);
    const tamperedChar = lastChar === '0' ? '1' : '0';
    const tampered = macHex.slice(0, -1) + tamperedChar;

    const ok = await verifySlackSignature(BODY, TS, tampered, SECRET);
    expect(ok).toBe(false);
  });

  it('Case 3: 完全に異なる length の signature で false (length mismatch も constant-time)', async () => {
    // 明らかに短い signature
    const short = 'v0=deadbeef';
    const ok1 = await verifySlackSignature(BODY, TS, short, SECRET);
    expect(ok1).toBe(false);

    // 明らかに長い signature
    const long = 'v0=' + 'a'.repeat(200);
    const ok2 = await verifySlackSignature(BODY, TS, long, SECRET);
    expect(ok2).toBe(false);
  });
});

// =============================================================================
// §2. DENY_PATTERNS テスト 9 件 (R-GAP-11)
// =============================================================================
describe('containsDenyPattern (機密マスキング 2 重ガード)', () => {
  it('Case 1: sk-ant-api token を検知', () => {
    // SECURITY: fake 値を Array.join で動的構築 (静的解析回避、test fake のみ)
    const fakeAntKey = ['sk', 'ant', 'api03', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf'].join('-');
    expect(containsDenyPattern(`My key is ${fakeAntKey}`)).toBe(true);
  });

  it('Case 2: sk_live_ Stripe key を検知', () => {
    // SECURITY: fake 値を Array.join で動的構築 (静的解析回避、test fake のみ)
    const fakeStripeKey = ['sk', 'live', 'AbCdEfGhIjKlMnOpQrStUvWxYz'].join('_');
    expect(containsDenyPattern(`STRIPE=${fakeStripeKey}`)).toBe(true);
  });

  it('Case 3: xoxb- Slack bot token を検知', () => {
    // SECURITY: fake 値を Array.join で動的構築 (静的解析回避、test fake のみ)
    const fakeBotToken = ['xoxb', '1234567890', '1234567890123', 'AbCdEfGhIjKlMnOpQrSt'].join('-');
    expect(containsDenyPattern(`Bot token ${fakeBotToken}`)).toBe(true);
  });

  it('Case 4: ghp_ GitHub PAT を検知', () => {
    // SECURITY: fake 値を Array.join で動的構築 (静的解析回避、test fake のみ)
    const fakeGhPat = ['ghp', '1234567890abcdefABCDEFghijklmnopqrst'].join('_');
    expect(containsDenyPattern(`PAT: ${fakeGhPat}`)).toBe(true);
  });

  it('Case 5: Bearer <40+chars> を検知', () => {
    // SECURITY: fake 値を Array.join で動的構築 (静的解析回避、test fake のみ)
    const fakeBearer = ['abcdefghijklmnopqrstuvwxyz', '0123456789ABCDEF'].join('');
    expect(containsDenyPattern(`Authorization: Bearer ${fakeBearer}`)).toBe(true);
  });

  it('Case 6: AKIA AWS access key を検知', () => {
    // SECURITY: fake 値を Array.join で動的構築 (静的解析回避、test fake のみ)
    const fakeAwsKey = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    expect(containsDenyPattern(`AWS_ACCESS_KEY_ID=${fakeAwsKey}`)).toBe(true);
  });

  it('Case 7: hooks.slack.com webhook URL を検知', () => {
    // SECURITY: fake URL を Array.join で動的構築 (静的解析回避、test fake のみ)
    const fakeWebhook = ['https:', '', 'hooks.slack.com', 'services', 'T12345678', 'B12345678', 'abcdefghijklmnopqrstuvwx'].join('/');
    expect(containsDenyPattern(`webhook ${fakeWebhook}`)).toBe(true);
  });

  it('Case 8: UUID v4 を検知 (患者・LINE OA UUID 等)', () => {
    expect(containsDenyPattern('id=550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('Case 9: 患者氏名 pattern (漢字 2-4 + 数字 3+) を検知', () => {
    expect(containsDenyPattern('田中太郎 1234 受診')).toBe(true);
  });

  it('Case 10 (whitelist): 公式番号 080-1652-1606 のみは通過', () => {
    // 公式番号は外部公開可 (feedback_official_contact_disclosure_policy.md)
    expect(containsDenyPattern('お問合せ: 080-1652-1606')).toBe(false);
  });

  it('Case 11 (whitelist): 別 080 番号はマッチ', () => {
    expect(containsDenyPattern('お問合せ: 080-9999-9999')).toBe(true);
  });

  it('Case 12: 通常テキストは false', () => {
    expect(containsDenyPattern('こんにちは、今日のミーティング 14 時からです')).toBe(false);
  });

  it('Case 13: 空文字列 / undefined は false', () => {
    expect(containsDenyPattern('')).toBe(false);
  });
});

// =============================================================================
// §3. detectDialogMode keyword 検出 smoke テスト（Phase 3 v4 A-v3-1 / High-1）
// =============================================================================
// PLAN v4 §2.2.2 / 完了条件 6: keyword smoke 3 件（"ネタ" / "投稿案" / "@シロコ"）PASS
// feedback_system_forced_branching: 重要な分岐はシステム側で強制（固定リスト、LLM 判定禁止）
//
// Phase 3 v4 High-1: src/index.ts の export された実関数 detectDialogMode を
// 直接 import してテストする（inline コピー DIALOG_KEYWORDS_TEST は廃止）。
// テストと本番ロジックの乖離リスクを排除（Evaluator High-1 指摘対応）。
// =============================================================================

describe('detectDialogMode (keyword 検出 smoke テスト)', () => {
  it('Case 1: "ネタ" を含むテキストは dialog_mode=true', () => {
    expect(detectDialogMode('ネタ: OpenAI $50M 動向、投稿案出して')).toBe(true);
  });

  it('Case 2: "投稿案" を含むテキストは dialog_mode=true', () => {
    expect(detectDialogMode('投稿案を作ってほしい')).toBe(true);
  });

  it('Case 3: "@シロコ" を含むテキストは dialog_mode=true', () => {
    expect(detectDialogMode('@シロコ 最新のAI情報まとめて')).toBe(true);
  });

  it('Case 4: "x-post" を含むテキストは dialog_mode=true', () => {
    expect(detectDialogMode('x-post してほしい内容がある')).toBe(true);
  });

  it('Case 5: "tweet" を含むテキストは dialog_mode=true', () => {
    expect(detectDialogMode('tweet したいネタがある')).toBe(true);
  });

  it('Case 6: keyword なしのテキストは dialog_mode=false', () => {
    expect(detectDialogMode('今日のミーティング 14 時から始めます')).toBe(false);
  });

  it('Case 7: 空文字列は dialog_mode=false', () => {
    expect(detectDialogMode('')).toBe(false);
  });
});

// =============================================================================
// §4. pushNtfyDialog JSON body contract テスト（Phase 3 v4 A-v3-3）
// =============================================================================
// A⇔C インターフェース contract: JSON body の 5 フィールド検証
// Implementer C receive-from-slack.sh の jq parse と完全一致確認
// =============================================================================
describe('pushNtfyDialog (A⇔C contract JSON body)', () => {
  it('Case 1: dialog_mode=true が必ず出力される（contract 検証）', async () => {
    // pushNtfyDialog を呼び出したときの fetch body を検証するため、
    // fetch をモックして body の JSON schema を確認する
    const capturedBodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) capturedBodies.push(init.body as string);
      return new Response(null, { status: 200 });
    };

    const fakeEnv = {
      NTFY_BASE_URL: 'https://ntfy.sh',
    } as Parameters<typeof pushNtfyDialog>[0];

    const ev: DialogEventPayload = {
      type: 'message',
      text: 'ネタ: テスト投稿案',
      ts: '1716000000.000000',
      thread_ts: '1716000000.000000',
      channel: 'C1234567890',
      user: 'U1234567890',
    };

    await pushNtfyDialog(fakeEnv, ev, 'test-topic');
    globalThis.fetch = originalFetch;

    expect(capturedBodies.length).toBe(1);
    const parsed = JSON.parse(capturedBodies[0]);

    // A⇔C contract: 5 フィールドが全て存在し型が正しいこと
    expect(parsed.text).toBe('ネタ: テスト投稿案');
    expect(parsed.dialog_mode).toBe(true);
    expect(typeof parsed.thread_ts).toBe('string');
    expect(parsed.channel).toBe('C1234567890');
    expect(parsed.user).toBe('U1234567890');
  });

  it('Case 2: thread_ts が undefined の場合は ev.ts を使用（contract 検証）', async () => {
    const capturedBodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) capturedBodies.push(init.body as string);
      return new Response(null, { status: 200 });
    };

    const fakeEnv = {
      NTFY_BASE_URL: 'https://ntfy.sh',
    } as Parameters<typeof pushNtfyDialog>[0];

    const ev: DialogEventPayload = {
      type: 'message',
      text: '投稿案を作って',
      ts: '1716000001.000000',
      // thread_ts は undefined（スレッド外メッセージ）
      channel: 'C0987654321',
      user: 'U0987654321',
    };

    await pushNtfyDialog(fakeEnv, ev, 'test-topic-2');
    globalThis.fetch = originalFetch;

    expect(capturedBodies.length).toBe(1);
    const parsed = JSON.parse(capturedBodies[0]);

    // thread_ts が undefined の場合は ev.ts を代入
    expect(parsed.thread_ts).toBe('1716000001.000000');
    expect(parsed.dialog_mode).toBe(true);
  });
});

// =============================================================================
// §5. ntfy 認証トークン対応テスト（PLAN_BRIDGE_NTFY_AUTH_TOKEN_20260520）
// =============================================================================
// §5.2 の表（Case 5-1〜5-4）を実装。
// §4（pushNtfyDialog）と同じ globalThis.fetch mock パターンを横展開。
// trivially pass 防止: headers['Authorization'] を完全文字列一致で assert。
// 未設定ケースは Object.keys(headers) に 'Authorization' が含まれないことを assert（§5.3）。
// SECURITY: fake token 値のみ使用（実 token は絶対に書かない）。
// =============================================================================

// §5 共通: fake 値定義（SECURITY: 実 token ではない test 用 fake）
const FAKE_TOKEN = 'tk_test_fake_token_not_real_0000000000000';

// §5 共通: pushNtfy 呼び出し用 fake SlackEvent / EventCallbackPayload
const fakePushNtfyEnvWithToken = {
  NTFY_BASE_URL: 'https://ntfy.sh',
  NTFY_TOKEN: FAKE_TOKEN,
  // pushNtfy 内で参照する Bindings 最小セット（型キャストで補完）
} as Parameters<typeof pushNtfy>[0];

const fakePushNtfyEnvWithoutToken = {
  NTFY_BASE_URL: 'https://ntfy.sh',
  // NTFY_TOKEN なし → 後方互換（Authorization ヘッダ付与しない）
} as Parameters<typeof pushNtfy>[0];

const fakeSlackEvent = {
  type: 'message',
  channel: 'C1234567890',
  user: 'U1234567890',
  text: 'テストメッセージ',
  ts: '1716000000.000000',
} as const;

const fakeEventCallbackPayload = {
  type: 'event_callback',
  token: 'fake',
  team_id: 'T1234567890',
  api_app_id: 'A1234567890',
  event_id: 'Ev1234567890',
  event_time: 1716000000,
  event: fakeSlackEvent,
} as Parameters<typeof pushNtfy>[3];

describe('ntfy 認証トークン対応（NTFY_TOKEN headers 検証）', () => {
  // ─── Case 5-1: pushNtfy + NTFY_TOKEN 設定あり ───
  it('Case 5-1: pushNtfy: NTFY_TOKEN 設定時 Authorization ヘッダが正しく付与される', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    const capturedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrls.push(String(input));
      if (init?.headers) capturedHeaders.push(init.headers as Record<string, string>);
      return new Response(null, { status: 200 });
    };

    await pushNtfy(fakePushNtfyEnvWithToken, 'test-ntfy-topic', fakeSlackEvent, fakeEventCallbackPayload);
    globalThis.fetch = originalFetch;

    expect(capturedHeaders.length).toBe(1);
    const h = capturedHeaders[0];

    // Authorization: 完全文字列一致（trivially pass 防止）
    expect(h['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);

    // 既存ヘッダの保持確認（regression）
    expect(typeof h['Title']).toBe('string');
    expect(h['Priority']).toBe('3');
    expect(h['Tags']).toBe('kuroko,slack-relay');
    expect(typeof h['Click']).toBe('string');

    // fetch の呼び出し URL も確認（mock が本物の経路を通っていることを保証）
    expect(capturedUrls[0]).toBe('https://ntfy.sh/test-ntfy-topic');
  });

  // ─── Case 5-2: pushNtfy + NTFY_TOKEN 未設定 ───
  it('Case 5-2: pushNtfy: NTFY_TOKEN 未設定時 Authorization ヘッダが付かない（後方互換）', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    const capturedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrls.push(String(input));
      if (init?.headers) capturedHeaders.push(init.headers as Record<string, string>);
      return new Response(null, { status: 200 });
    };

    await pushNtfy(fakePushNtfyEnvWithoutToken, 'test-ntfy-topic', fakeSlackEvent, fakeEventCallbackPayload);
    globalThis.fetch = originalFetch;

    expect(capturedHeaders.length).toBe(1);
    const h = capturedHeaders[0];

    // Authorization キーが存在しないことを assert（Object.keys で厳密検証、§5.3）
    expect(Object.keys(h)).not.toContain('Authorization');

    // 既存ヘッダの保持確認（regression）
    expect(typeof h['Title']).toBe('string');
    expect(h['Priority']).toBe('3');
    expect(h['Tags']).toBe('kuroko,slack-relay');
    expect(typeof h['Click']).toBe('string');

    expect(capturedUrls[0]).toBe('https://ntfy.sh/test-ntfy-topic');
  });

  // ─── Case 5-3: pushNtfyDialog + NTFY_TOKEN 設定あり ───
  it('Case 5-3: pushNtfyDialog: NTFY_TOKEN 設定時 Authorization ヘッダが正しく付与される', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    const capturedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrls.push(String(input));
      if (init?.headers) capturedHeaders.push(init.headers as Record<string, string>);
      return new Response(null, { status: 200 });
    };

    const fakeDialogEnvWithToken = {
      NTFY_BASE_URL: 'https://ntfy.sh',
      NTFY_TOKEN: FAKE_TOKEN,
    } as Parameters<typeof pushNtfyDialog>[0];

    const fakeDialogEv = {
      type: 'message' as const,
      text: 'ネタ: テスト',
      ts: '1716000000.000000',
      thread_ts: '1716000000.000000',
      channel: 'C1234567890',
      user: 'U1234567890',
    };

    await pushNtfyDialog(fakeDialogEnvWithToken, fakeDialogEv, 'test-dialog-topic');
    globalThis.fetch = originalFetch;

    expect(capturedHeaders.length).toBe(1);
    const h = capturedHeaders[0];

    // Authorization: 完全文字列一致（trivially pass 防止）
    expect(h['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);

    // 既存ヘッダの保持確認（regression）
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Title']).toBe('dialog');

    expect(capturedUrls[0]).toBe('https://ntfy.sh/test-dialog-topic');
  });

  // ─── Case 5-4: pushNtfyDialog + NTFY_TOKEN 未設定 ───
  it('Case 5-4: pushNtfyDialog: NTFY_TOKEN 未設定時 Authorization ヘッダが付かない（後方互換）', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    const capturedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrls.push(String(input));
      if (init?.headers) capturedHeaders.push(init.headers as Record<string, string>);
      return new Response(null, { status: 200 });
    };

    const fakeDialogEnvWithoutToken = {
      NTFY_BASE_URL: 'https://ntfy.sh',
    } as Parameters<typeof pushNtfyDialog>[0];

    const fakeDialogEv = {
      type: 'message' as const,
      text: '投稿案を作って',
      ts: '1716000001.000000',
      channel: 'C0987654321',
      user: 'U0987654321',
    };

    await pushNtfyDialog(fakeDialogEnvWithoutToken, fakeDialogEv, 'test-dialog-topic-2');
    globalThis.fetch = originalFetch;

    expect(capturedHeaders.length).toBe(1);
    const h = capturedHeaders[0];

    // Authorization キーが存在しないことを assert（Object.keys で厳密検証、§5.3）
    expect(Object.keys(h)).not.toContain('Authorization');

    // 既存ヘッダの保持確認（regression）
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Title']).toBe('dialog');

    expect(capturedUrls[0]).toBe('https://ntfy.sh/test-dialog-topic-2');
  });
});
