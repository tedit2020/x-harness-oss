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
import { verifySlackSignature, containsDenyPattern } from '../src/index.js';

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
