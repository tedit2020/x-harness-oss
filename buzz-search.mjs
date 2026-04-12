#!/usr/bin/env node
// =====================================================
// Claude Code バズ投稿検索スクリプト
// X API v2 直接呼び出しでバズツイートを収集
// =====================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const REPO_DIR = resolve(import.meta.dirname || '.');
const ENV_PATH = resolve(REPO_DIR, '../.env');
const OUTPUT_DIR = resolve(REPO_DIR, 'docs');
const OUTPUT_PATH = resolve(OUTPUT_DIR, 'buzz-report.md');

// 検索キーワード
const SEARCH_QUERIES = [
  '"Claude Code" -is:retweet lang:ja -is:reply',
  '"Claude Code" (新機能 OR アップデート OR リリース OR 対応) -is:retweet lang:ja',
  '"Claude Code" (使い方 OR 活用 OR 自動化 OR 効率化 OR 事例) -is:retweet lang:ja',
];

// --- Load .env ---
if (!existsSync(ENV_PATH)) {
  console.error('[ERROR] .env が見つかりません');
  process.exit(1);
}
const envContent = readFileSync(ENV_PATH, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) env[m[1]] = m[2].trim();
}

// --- OAuth 1.0a ---
function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function callXApi(url) {
  const oauthParams = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };
  const urlObj = new URL(url);
  const allParams = { ...oauthParams };
  urlObj.searchParams.forEach((v, k) => { allParams[k] = v; });
  const paramString = Object.keys(allParams).sort()
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join('&');
  const baseString = ['GET', percentEncode(`${urlObj.origin}${urlObj.pathname}`), percentEncode(paramString)].join('&');
  const signingKey = `${percentEncode(env.X_API_SECRET)}&${percentEncode(env.X_ACCESS_TOKEN_SECRET)}`;
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw', new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(baseString));
  oauthParams.oauth_signature = Buffer.from(sig).toString('base64');
  const header = Object.keys(oauthParams).sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`).join(', ');

  const res = await fetch(url, { headers: { Authorization: `OAuth ${header}` } });
  return { status: res.status, data: await res.json() };
}

// --- Main ---
console.log('');
console.log('==========================================');
console.log('  Claude Code バズ投稿検索');
console.log('==========================================');
console.log('');

const allResults = [];
const seen = new Set();

for (const query of SEARCH_QUERIES) {
  console.log(`  検索: ${query.slice(0, 60)}...`);
  try {
    const params = new URLSearchParams({
      query,
      max_results: '10',
      'tweet.fields': 'public_metrics,created_at,author_id',
      'user.fields': 'username,name',
      expansions: 'author_id',
    });
    const { status, data } = await callXApi(`https://api.x.com/2/tweets/search/recent?${params}`);

    if (status !== 200) {
      console.log(`    → エラー [${status}] ${data.title || ''}`);
      continue;
    }

    const tweets = data.data || [];
    const users = new Map();
    for (const u of data.includes?.users || []) {
      users.set(u.id, u);
    }

    console.log(`    → ${tweets.length}件ヒット`);

    for (const tweet of tweets) {
      if (seen.has(tweet.id)) continue;
      seen.add(tweet.id);
      const user = users.get(tweet.author_id);
      allResults.push({
        id: tweet.id,
        text: tweet.text,
        username: user?.username || 'unknown',
        displayName: user?.name || '',
        likes: tweet.public_metrics?.like_count || 0,
        rts: tweet.public_metrics?.retweet_count || 0,
        replies: tweet.public_metrics?.reply_count || 0,
        createdAt: tweet.created_at,
      });
    }
  } catch (e) {
    console.log(`    → 失敗: ${e.message}`);
  }
}

// いいね数でソート
allResults.sort((a, b) => b.likes - a.likes);

// レポート生成
const jstOffset = 9 * 60 * 60 * 1000;
const now = new Date();
const jstStr = new Date(now.getTime() + jstOffset).toISOString();
const jstDate = jstStr.split('T')[0];
const jstTime = jstStr.split('T')[1].slice(0, 5);

let report = `# Claude Code バズ投稿レポート\n\n`;
report += `**取得日時:** ${jstDate} ${jstTime} JST\n`;
report += `**ヒット数:** ${allResults.length}件（重複除外済み）\n\n`;
report += `---\n\n`;

if (allResults.length === 0) {
  report += `該当する投稿が見つかりませんでした。\n`;
} else {
  for (let i = 0; i < allResults.length; i++) {
    const t = allResults[i];
    const preview = t.text.replace(/\n/g, ' ');

    report += `### ${i + 1}. @${t.username}（${t.displayName}）\n`;
    report += `**${t.likes}♥ / ${t.rts}RT / ${t.replies}リプ**\n\n`;
    report += `> ${preview}\n\n`;
    report += `- URL: https://x.com/${t.username}/status/${t.id}\n`;
    report += `- 投稿日: ${t.createdAt?.slice(0, 10) || '不明'}\n\n`;
  }
}

// 保存
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_PATH, report);

console.log('');
console.log(`  レポート: ${OUTPUT_PATH}`);
console.log(`  合計: ${allResults.length}件`);

if (allResults.length > 0) {
  console.log('');
  console.log('  ── トップ5 ──');
  for (let i = 0; i < Math.min(5, allResults.length); i++) {
    const t = allResults[i];
    const preview = t.text.replace(/\n/g, ' ').slice(0, 50);
    console.log(`  ${i + 1}. [${t.likes}♥] @${t.username}: ${preview}...`);
  }
}

console.log('');
console.log('  API消費: 検索 ' + SEARCH_QUERIES.length + '回 × $0.005 = $' + (SEARCH_QUERIES.length * 0.005).toFixed(3));
console.log('');
