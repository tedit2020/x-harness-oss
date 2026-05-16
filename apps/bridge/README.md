# kuroko-sisters-bridge

Phase 3 カラーズ通信インフラ (2026-05-22 アカコ誕生日完成目標) の Cloudflare Worker。

Slack Events API 受信 → HMAC SHA-256 検証 → ntfy fanout (3 ch) + GitHub Contents API push (kuroko-org colors_log)。

## 構成

```
apps/bridge/
├── .gitignore                     # R-GAP-7 (a) .dev.vars + wrangler.toml.local 明記
├── package.json
├── tsconfig.json
├── wrangler.toml                  # TEMPLATE (account_id placeholder で commit)
├── wrangler.toml.local.example    # 実値投入の手順サンプル
├── README.md                      # 本ファイル
├── src/
│   ├── index.ts                   # Hono v4 + Slack Events API endpoint
│   └── types.ts                   # Bindings + Slack payload 型定義
└── test/
    └── index.test.ts              # HMAC 3 件 + DENY 9 件 (vitest)
```

## 5/18 以降の Implementer A 残作業 (本 README で SOP 化、SCW 厳守)

本日 5/17 朝は **scaffold + コード起草のみ** が完了済。
以降の **不可逆操作** は朝のまっさん最終承認後に実施する。

### Step 1. 依存解決 + typecheck (5/18 夜、可逆)

```bash
cd /Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss
pnpm install
cd apps/bridge
pnpm typecheck
pnpm test
```

期待: typecheck 0 error、test 全件 PASS (HMAC 3 件 + DENY 9 件)。

### Step 2. wrangler.toml.local 作成 + assume-unchanged (5/18 夜、まっさん作業)

**ファイル内容 5 項目 MUST 適用 (R-GAP-7 Critical)**:

| # | 項目 | 適用方法 |
|---|---|---|
| (a) | `.gitignore` に `.dev.vars` + `wrangler.toml.local` 明記 | 既適用 (本ディレクトリ `.gitignore` 参照) |
| (b) | `wrangler.toml` の `account_id` placeholder + ローカル実値 + assume-unchanged | 下記コマンドで適用 |
| (c) | `git diff HEAD --name-only` でゼロ件 | deploy 直前 MUST 確認 |
| (d) | `console.log` の secret prefix 出力禁止 | `src/index.ts` で適用済 (sigPrefix のみ OK、SLACK_SIGNING_SECRET / SLACK_BOT_TOKEN / GITHUB_PAT prefix 出力一切なし) |
| (e) | commit/push 前 `leak-check` skill 実行 PASS | deploy 前 MUST 実行 |

**(b) 適用コマンド** (まっさん作業、別ターミナルから):

```bash
cd /Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/apps/bridge

# wrangler.toml.local を作成 (template から複製)
cp wrangler.toml.local.example wrangler.toml.local
# wrangler.toml.local を編集して account_id 等を実値に置換
# (まっさんが Cloudflare dashboard + wrangler whoami から取得して手入力)

# wrangler は wrangler.toml を読むため、deploy 時は wrangler.toml を実値で上書き編集
# → ローカル編集を git から追跡外しする (R-GAP-7 (b))
git update-index --assume-unchanged apps/bridge/wrangler.toml

# 確認: 状態 'h' (assume-unchanged) が立っていれば OK
git ls-files -v apps/bridge/wrangler.toml | grep '^h' && echo "assume-unchanged OK"
```

**注意**: assume-unchanged は **ローカル設定のみ**。他カラーズ環境では別途同じコマンドが必要。
clone 環境では template 値 (`<CF_ACCOUNT_ID>`) のままなので deploy 不可 (これは設計上の保護)。

### Step 3. .dev.vars 作成 (5/18 夜、wrangler dev 用、まっさん作業)

```bash
cd /Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/apps/bridge

# .dev.vars は .gitignore 済 (R-GAP-7 (a))
cat <<'EOF' > .dev.vars
SLACK_SIGNING_SECRET=<実値、Slack App > Basic Information > App Credentials から>
SLACK_BOT_TOKEN=xoxb-<実値、5/21 夜 install 後>
GITHUB_PAT=ghp_<実値、kuroko-org 専用新規発行、scope=repo or contents:write>
NTFY_TOPIC_KEDIT=<実値、Bitwarden 経由 carryover>
NTFY_TOPIC_BIKA=<実値、Bitwarden 経由 carryover>
NTFY_TOPIC_AKAKO=<実値、5/22 配布時に追加>
EOF

chmod 600 .dev.vars
```

**SOP 厳守 (シロコ Day 8 インシデント 6 教訓、`feedback_secret_name_inference_trap.md`)**:
- 実値を `cat <<EOF` で流し込む時、shell history に残らないように `set +o history` を一時的に
- まっさん別ターミナルで投入 → クロコ会話に流入させない
- 編集後 `cat .dev.vars` は **絶対しない** (jsonl 流入防止)

### Step 4. ローカル wrangler dev + Slack url_verification (5/18 夜、可逆だが Slack 側 verify)

```bash
cd /Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/apps/bridge

# tunnel 経由で外部公開 (Cloudflare tunnel or ngrok)
# 本来は cloudflared tunnel 推奨、ngrok だと free tier で URL 毎回変わる
pnpm wrangler dev --tunnel
# → 表示された URL (例: https://<random>.trycloudflare.com) を控える

# 別ターミナルで /health 確認
curl https://<tunnel-url>/health

# Slack App 管理画面 > Event Subscriptions > Request URL に
#   https://<tunnel-url>/slack/events
# を入力 → Slack が自動で url_verification POST → "Verified" 緑バッジ点灯で PASS
```

**STOP 兆候 (Emergency SCW SOP、PLAN §6.5)**:
- verify FAILED 連発 → HMAC 検証ロジック疑い → クロコ呼出
- wrangler dev 起動エラー → 依存解決 or wrangler 認証エラー → クロコ呼出

### Step 5. preview deploy (5/19 朝以降、不可逆だが rollback 可、まっさん承認後)

```bash
cd /Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/apps/bridge

# 事前: leak-check skill 実行
# /leak-check apps/bridge/

# 事前: git diff HEAD --name-only でゼロ件確認 (R-GAP-7 (c))
git diff HEAD --name-only
# → 何も表示されなければ OK (wrangler.toml ローカル編集は assume-unchanged で出ない)

# preview deploy
pnpm deploy:preview
# = wrangler versions upload --preview-alias phase3-rc1

# preview URL で /health + Slack verify 確認
curl https://phase3-rc1.kuroko-sisters-bridge.<account-subdomain>.workers.dev/health
```

### Step 6. wrangler secret put 7 件 (5/19-20、まっさん作業)

```bash
cd /Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/apps/bridge

# 対話的入力 (-w 引数なし、shell history に残さない、シロコ Day 8 SOP)
pnpm wrangler secret put SLACK_SIGNING_SECRET
pnpm wrangler secret put SLACK_BOT_TOKEN          # 5/21 夜 install 後
pnpm wrangler secret put GITHUB_PAT
pnpm wrangler secret put NTFY_TOPIC_KEDIT
pnpm wrangler secret put NTFY_TOPIC_BIKA
pnpm wrangler secret put NTFY_TOPIC_AKAKO         # 5/22 配布時
# (オプション) pnpm wrangler secret put NTFY_TOPIC_BROADCAST

# 確認 (キー名のみ表示、実値は表示されない)
pnpm wrangler secret list
```

### Step 7. 本番 deploy (5/21 夕、不可逆だが wrangler rollback で戻せる、まっさん承認後)

```bash
cd /Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/apps/bridge

# 本番昇格 (preview → production)
pnpm deploy:promote
# = wrangler versions deploy

# 本番 URL を Slack App 管理画面 > Event Subscriptions > Request URL に設定
#   https://kuroko-sisters-bridge.<account-subdomain>.workers.dev/slack/events
# → "Verified" 緑バッジ点灯で PASS

# deploy 直後 60 分間 /health を curl で動作確認 (R-GAP-1)
for i in $(seq 1 60); do
  curl -s -o /dev/null -w "%{http_code} %{time_total}\n" \
    https://kuroko-sisters-bridge.<account-subdomain>.workers.dev/health
  sleep 60
done
# → 5xx ゼロ確認、5xx 連発時即 wrangler rollback 判断
```

**重要 (`feedback_workers_assets_no_rollback.md`)**: Phase 3 bridge は Workers Assets を使わない (静的アセットなし、Worker code のみ) → rollback は code のみ戻すで完結。

### Step 8. BOT_USER_ID 追記 + 再 deploy (5/21 夜、Implementer B から ID 受領後、M-5)

```bash
# Implementer B 経由でまっさん install 後に Bot User ID (U...) を受領
# wrangler.toml [vars] に追記:
#   BOT_USER_ID = "U..."

# 再 deploy (無限ループ防止有効化)
pnpm wrangler deploy
```

### Step 9. smoke test 15 件 (Implementer C 担当 phase3-smoke.sh、5/22 朝)

PLAN §4.6 の 15 件 (HMAC ベクトル 3 + DENY 9 + url_verification + retry + bot 無視 + GitHub log + launchd 等)。
Worker 側の単体テストは `pnpm test` で常時実行可能。

## 横断整合性責務 (M-12 + R-GAP-19)

Implementer A は隣接 Implementer の担当境界を明示する責務を持つ:

### A ↔ B (Slack Bot manifest)

- **request_url**: Implementer B が manifest.yaml に `<CF_WORKER_PRODUCTION_URL_TBD>` placeholder で commit → 5/21 夕 Implementer A 本番 deploy 完了後、本番 URL (`https://kuroko-sisters-bridge.<account-subdomain>.workers.dev/slack/events`) を B に共有 → install 直前 placeholder 置換 (JD-15)
- **BOT_USER_ID**: 5/21 夜まっさん install 後に B から Bot User ID (U...) を受領 → wrangler.toml [vars] に追記 → 再 deploy (Step 8)

### A ↔ C (受信側 scripts + DENY)

- **ntfy topic**: C が `~/.claude/.receive_topic` 等で Bitwarden 経由 carryover topic を確定後、A の wrangler secret (NTFY_TOPIC_KEDIT / BIKA / AKAKO) に投入 (Step 6)
- **DENY patterns**: C の `~/.claude/scripts/common-deny-patterns.sh` bash 配列 12 件と、本 worker `src/index.ts containsDenyPattern` の TypeScript regex を **1:1 一致** 強制。5/20 朝の境界中間チェック (phase3-smoke.sh test #14) で `diff = 0` 確認 (M-11 + R-GAP-11)

### 境界発見時の対応

- 境界差分発見時は **即報告、修正は担当外**。クロコに統合依頼。

## 機密マスキング自己レビュー

| 機密カテゴリ | 本リポジトリ commit 対象 | 状態 |
|---|---|---|
| 実 Slack signing secret | なし (wrangler secret put + .dev.vars (gitignored)) | PASS |
| 実 Slack bot token | なし | PASS |
| 実 Webhook URL | なし | PASS |
| 実 Worker URL (account-subdomain 付) | wrangler.toml は `<account-subdomain>` placeholder | PASS |
| 実 GitHub PAT | なし | PASS |
| 実 ntfy topic UUID | なし | PASS |
| 実 CF account_id | wrangler.toml は `<CF_ACCOUNT_ID>` placeholder | PASS |
| 実 GitHub owner | wrangler.toml は `<GITHUB_OWNER>` placeholder | PASS |
| 実 BOT_USER_ID | wrangler.toml はコメントアウト + placeholder | PASS |
| `console.log` secret prefix | sigPrefix (10 char) のみ、secret prefix なし | PASS |

## 関連 memory + 参考資料

- `feedback_credential_file_access_principle.md` — 9 原則、特に原則 9 (template/実値乖離)
- `feedback_secret_name_inference_trap.md` — secret 名から認証方式推測禁止
- `feedback_external_output_masking.md` — Worker console.log マスキング
- `feedback_workers_assets_no_rollback.md` — Phase 3 は Assets 不使用、rollback で code 戻る
- `feedback_destructive_action_guard.md` — deploy 対象目視確認
- `feedback_dev_org_policy.md` §5 安全対策 + §6 機密漏洩確認
- PLAN: `docs/PLAN_PHASE3_COLORS_INFRA_20260516.md` §4.1 + §6.1
- RESEARCH: `docs/RESEARCH_PHASE3_R1_CFWORKER_SLACK_EVENTS_20260516.md` §1-§13

## Emergency SCW SOP

困ったら STOP + クロコ呼出 (PLAN §6.5):

**STOP 兆候**:
- wrangler deploy 失敗 3 連続
- leak-check 警告
- wrangler 認証エラー
- Slack 401 連発 (HMAC 検証 fail)
- HMAC ベクトルテスト 1 件以上 fail
- bridge 配置 5 項目 MUST のうち 1 件以上 fail
- `git diff HEAD --name-only` で `.dev.vars` / `.local` 検出

**CALL**: クロコに「@クロコ SCW: <兆候>」で簡潔報告 (影響範囲 + 既実施 step)

**WAIT**: クロコ判断 (rollback 可能 + 機密漏洩リスクなしなら自律進行、それ以外まっさん起床待ち)
