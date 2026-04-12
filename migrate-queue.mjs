#!/usr/bin/env node
// =====================================================
// X auto-poster → X Harness 移植スクリプト
// queue/posts.json の20件をX Harnessの予約投稿に登録
// =====================================================
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_DIR = resolve(import.meta.dirname || '.');
const QUEUE_PATH = resolve(REPO_DIR, '../queue/posts.json');
const CRED_PATH = resolve(REPO_DIR, '.x-harness-credentials.local');
const WORKER_URL = 'https://x-harness-worker.tedit.workers.dev';

// スケジュール設定（config.yaml準拠）
const SLOTS = [
  { time: '06:00', label: '早朝 - モチベーション系' },
  { time: '08:00', label: '朝 - ノウハウ・Tips系' },
  { time: '12:00', label: '昼 - 事例・実績系' },
  { time: '18:00', label: '夕方 - 問いかけ・共感系' },
  { time: '21:00', label: '夜 - まとめ・CTA系' },
];

// --- 1. Load credentials ---
if (!existsSync(CRED_PATH)) {
  console.error('  [ERROR] 先にsetup-auto.mjsを実行してください');
  process.exit(1);
}
const credContent = readFileSync(CRED_PATH, 'utf-8');
const apiKey = credContent.match(/API_KEY=(.+)/)?.[1];
if (!apiKey) {
  console.error('  [ERROR] API_KEYが見つかりません');
  process.exit(1);
}

// --- 2. Get X Account ID ---
console.log('\n==========================================');
console.log('  X auto-poster → X Harness 移植');
console.log('==========================================\n');

const accountsRes = await fetch(`${WORKER_URL}/api/x-accounts`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const accountsData = await accountsRes.json();
const xAccountId = accountsData.data?.[0]?.id;
if (!xAccountId) {
  console.error('  [ERROR] Xアカウントが見つかりません');
  process.exit(1);
}
console.log(`  [OK] Xアカウント: ${accountsData.data[0].username} (${xAccountId})`);

// --- 3. Load queue ---
if (!existsSync(QUEUE_PATH)) {
  console.error(`  [ERROR] キューファイルが見つかりません: ${QUEUE_PATH}`);
  process.exit(1);
}
const posts = JSON.parse(readFileSync(QUEUE_PATH, 'utf-8'));
const queuedPosts = posts.filter(p => p.status === 'queued');
console.log(`  [OK] キューから ${queuedPosts.length} 件の投稿を読み込みました`);

if (queuedPosts.length === 0) {
  console.log('  移植する投稿がありません。');
  process.exit(0);
}

// --- 4. Assign schedule (tomorrow start, 5 posts/day) ---
// 明日のJST 06:00 からスタート
const now = new Date();
const jstOffset = 9 * 60 * 60 * 1000;
const tomorrow = new Date(now.getTime() + jstOffset);
tomorrow.setUTCHours(0, 0, 0, 0); // 今日のJST 00:00 in UTC
const startDate = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000); // 明日JST 00:00 in UTC

const scheduled = [];
let slotIndex = 0;
let dayOffset = 0;

for (const post of queuedPosts) {
  const slot = SLOTS[slotIndex];
  const [hours, minutes] = slot.time.split(':').map(Number);

  // JST時刻をUTC ISOに変換
  const scheduledDate = new Date(startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  scheduledDate.setUTCHours(hours - 9, minutes, 0, 0); // JST→UTC

  scheduled.push({
    ...post,
    scheduledAt: scheduledDate.toISOString(),
    slotLabel: slot.label,
    dayOffset,
  });

  slotIndex++;
  if (slotIndex >= SLOTS.length) {
    slotIndex = 0;
    dayOffset++;
  }
}

// --- 5. Preview ---
console.log('\n  投稿予定スケジュール:');
console.log('  ─────────────────────────────────────');
let currentDay = -1;
for (const s of scheduled) {
  if (s.dayOffset !== currentDay) {
    currentDay = s.dayOffset;
    const dateStr = new Date(new Date(s.scheduledAt).getTime() + jstOffset)
      .toISOString().split('T')[0];
    console.log(`\n  【${dateStr}】`);
  }
  const jstTime = new Date(new Date(s.scheduledAt).getTime() + jstOffset)
    .toISOString().split('T')[1].slice(0, 5);
  const preview = s.post_text.split('\n')[0].slice(0, 40);
  console.log(`    ${jstTime} [${s.slotLabel}] ${preview}...`);
}

// --- 6. Confirm and register ---
console.log('\n  ─────────────────────────────────────');
console.log(`  合計: ${scheduled.length} 件を予約投稿に登録します`);
console.log('');

let success = 0;
let fail = 0;

for (const s of scheduled) {
  try {
    const res = await fetch(`${WORKER_URL}/api/posts/schedule`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        xAccountId,
        text: s.post_text,
        scheduledAt: s.scheduledAt,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      success++;
    } else {
      console.error(`  [FAIL] ID:${s.id} - ${JSON.stringify(data)}`);
      fail++;
    }
  } catch (e) {
    console.error(`  [FAIL] ID:${s.id} - ${e.message}`);
    fail++;
  }
}

console.log('\n==========================================');
console.log(`  移植完了！ 成功: ${success} 件 / 失敗: ${fail} 件`);
console.log('==========================================');
console.log(`\n  Admin URL で確認: https://x-harness-admin-70y.pages.dev`);
console.log('  → 「予約投稿」ページで一覧が見えます\n');
