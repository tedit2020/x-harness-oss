# X Harness セキュリティ監査レポート
調査日: 2026-04-11

---

## 1. 機密ファイル

### `/Users/kedit/Desktop/dev/x-auto-poster/.env`
- **存在: あり**
- 含まれるキー名（値は非記録）:
  - `X_API_KEY`
  - `X_API_SECRET`
  - `X_ACCESS_TOKEN`
  - `X_ACCESS_TOKEN_SECRET`
- 評価: `.gitignore` でルートリポジトリから除外済み（問題なし）

### `/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/.x-harness-credentials.local`
- **存在: あり**
- 含まれるキー名（値は非記録）:
  - `API_KEY`（xh_ プレフィックス付きのシステム生成キー）
  - `WORKER_URL`（本番 Workers URL）
  - `ADMIN_URL`（本番管理画面 URL）
  - `X_USERNAME`
  - `X_USER_ID`
- 評価: x-harness-oss の `.gitignore` に含まれている（問題なし）

### `/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/setup-secrets.sh`
- **存在: あり**
- 内容: セットアップスクリプト。実際のシークレット値は含まず、`../.env` を読み込む参照方式
- x-harness-oss の `.gitignore` に含まれている（問題なし）

### `/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/.mcp.json`
- **存在: あり**
- 含まれるキー名（値は非記録）:
  - `X_HARNESS_API_URL`（本番 Workers URL）
  - `X_HARNESS_API_KEY`（xh_ プレフィックス付きの API キー）
- **注意: API キーが平文で記載されている**
- x-harness-oss の `.gitignore` に含まれている（問題なし）

---

## 2. .gitignore の状態

### `/Users/kedit/Desktop/dev/x-auto-poster/.gitignore`（ルートリポジトリ）
```
.env           ✅ 含まれる
```
- **未記載（要確認）**:
  - `.x-harness-credentials.local` — 未記載
  - `.mcp.json` — 未記載
  - `setup-secrets.sh` — 未記載
- 備考: ルートは git リポジトリではないため実害なし。ただし x-harness-oss 側の .gitignore で対応済み

### `/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/.gitignore`（OSS リポジトリ）
- **現在のローカルファイル（未コミット状態）**:
  - `.mcp.json` ✅
  - `.x-harness-credentials.local` ✅
  - `setup-secrets.sh` ✅
  - `setup-auto.mjs` ✅
  - `.x-harness-setup.json` ✅
  - `.x-harness-config.json` ✅
  - `apps/web/.env.production` ✅
  - `node_modules/` ✅
  - `out/` ✅
  - `.dev.vars` ✅
- **重要: 上記 `.gitignore` の変更がまだコミットされていない**
  - `git status` で `modified: .gitignore` が確認された
  - HEAD（リモート）の `.gitignore` には `.mcp.json` 等の新エントリが含まれていない
  - 現在 untracked の機密ファイルが存在しても、リモートに push する前にコミットされなければ問題なし
  - ただし `.gitignore` を早急にコミットすることを強く推奨

---

## 3. CLAUDE.md のセキュリティルール

- **存在: あり** (`/Users/kedit/Desktop/dev/x-auto-poster/CLAUDE.md`)
- セキュリティセクション `<!-- BEGIN:safety-rules -->` が明記されている
- 含まれるルール:
  - `.env` ファイルの上書き・削除禁止 ✅
  - APIキー・シークレット・パスワードをコードに直書き禁止 ✅
  - `.env` ファイルをgitにコミットしない ✅
  - `.gitignore` の変更は事前確認 ✅
  - `git push --force` 禁止 ✅
- **評価: 適切なルールが定義されている**

---

## 4. wrangler.toml の機密情報

### ローカルファイル（未コミット）
`/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/apps/worker/wrangler.toml`
- `account_id` = 実際の Cloudflare Account ID が記載（ローカルのみ）
- `database_id` = 実際の D1 Database ID が記載（ローカルのみ）
- `WORKER_URL` = 本番 Workers URL が記載（ローカルのみ）
- API キー・アクセストークンはコメントで「wrangler secret put で設定」と明記されており、直書きなし ✅

### コミット済み（HEAD / リモート）
- `account_id` = 存在しない ✅
- `database_id` = `YOUR_D1_DATABASE_ID`（プレースホルダー）✅
- `WORKER_URL` = `https://x-harness-worker.workers.dev`（汎用URL）✅
- API キー・トークンの直書きなし ✅

**評価: Git 管理は適切。ローカルファイルはコミット前の作業状態で問題なし。**
ただし `account_id` と `database_id` がローカルの `wrangler.toml` に記載されていることは把握しておくべき。

---

## 5. ハードコード検索

### worker/src 配下
- `apps/worker/src/middleware/auth.ts`: `c.env.API_KEY` で環境変数参照 ✅
- 実際のキー・トークン・パスワード値のハードコードなし ✅

### packages 配下
- `packages/x-sdk/src/oauth1.ts` 等: 型定義・処理ロジックのみ、値のハードコードなし ✅
- `packages/mcp/src/index.ts`: `process.env.X_HARNESS_API_KEY` で環境変数参照 ✅

### ビルド成果物（apps/web/out/）
- ビルド済み JS に `https://x-harness-worker.tedit.workers.dev`（本番URL）が含まれる
- ただし `out/` は `.gitignore` で除外済みであり、API キーやトークンは含まれない ✅
- API キーは `localStorage.getItem("xh_api_key")` でランタイム取得する設計 ✅

**評価: ソースコードへのハードコードは発見されなかった。**

---

## 6. Git 履歴

### x-auto-poster ルート
- git リポジトリではない（git log で結果なし）

### x-harness-oss
- 全 116 コミット確認
- 注目コミット:
  - `1165597` `security: remove internal plans and sanitize WORKER_URL placeholder` — `wrangler.toml` の本番 URL をプレースホルダーに置換済み
  - `5f461f3` `sync: clean secrets, ...` — 機密情報のクリーンアップ実施
- `git log -S "tedit.workers.dev"` 検索 → 0件（本番URLは履歴に含まれない）✅
- `git log -S "[CLOUDFLARE_ACCOUNT_ID]"` 検索 → 0件（account_id は履歴に含まれない）✅
- `.env` ファイルがコミットされた履歴なし ✅
- `.mcp.json` がコミットされた履歴なし ✅

**評価: Git 履歴に機密情報の漏洩は発見されなかった。**

---

## リスク一覧

| # | リスク | 深刻度 | 詳細 |
|---|--------|--------|------|
| 1 | `.gitignore` の変更未コミット | **高** | x-harness-oss の `.gitignore` に `.mcp.json`、`.x-harness-credentials.local` 等が追加されているが未コミット。現時点では push されていないため実害なし。ただし誰かが `git add .` を実行した場合、機密ファイルが追跡対象になる可能性がある |
| 2 | `.mcp.json` に API キー平文記載 | **中** | ローカルマシン上の `.mcp.json` に API キーが平文で記載されている。`.gitignore` で除外済みのため Git 漏洩リスクは低いが、ファイルそのものの管理に注意 |
| 3 | `wrangler.toml` にローカル環境差分（account_id 等）| **低** | ローカルの `wrangler.toml` に `account_id`、`database_id`、本番URLが記載されているが、HEAD には含まれない。コミット時に誤って混入しないよう注意 |
| 4 | ルート `.gitignore` の網羅性 | **低** | ルートは git リポジトリではないが、`.x-harness-credentials.local`、`.mcp.json`、`setup-secrets.sh` がルート `.gitignore` に未記載。将来 git 管理する場合は追加が必要 |
| 5 | `setup-secrets.sh` でシェル出力にトークン表示 | **低** | スクリプト実行時に `API_KEY:` を `echo` 表示する処理がある。ターミナルログ・コマンド履歴への残留リスクがある |

---

## 推奨アクション（優先順）

1. **即時** — `x-harness-oss/.gitignore` の変更をコミット（`git add .gitignore && git commit -m "chore: update .gitignore for local secret files"`）
2. **近日中** — `wrangler.toml` のローカル変更（account_id 等）がコミットされないよう、`.gitignore` に `wrangler.toml` の差分管理ルールを設けるか、`wrangler.local.toml` に分離することを検討
3. **任意** — `setup-secrets.sh` の echo 出力でトークンを一部マスク（例: `xh_****` 形式で表示）

---

*調査範囲: ファイルを直接読んで確認した事実のみ記載。推測は含まない。*
