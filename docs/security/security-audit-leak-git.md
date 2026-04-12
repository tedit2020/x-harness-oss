# Git履歴＆外部漏洩調査レポート
調査日: 2026-04-11

---

## 1. x-harness-oss Git履歴

### コミット概要
- リモートURL: `https://github.com/Shudesu/x-harness-oss.git`
- **公開状態: PUBLIC（一般公開中）**
- 総コミット数: 85件
- 調査対象ブランチ: 全ブランチ（`--all`）
- reflog: HEAD@{0}〜HEAD@{2}（cloneからの3件のみ、ローカル変更は最新2件のgitignore更新）

### 機密情報検索結果

| 検索パターン | ヒット数（コミット数） | 詳細 |
|---|---|---|
| `sk-` | 3件 | 全て計画ドキュメント（plans/*.md）内の文字列「Bearer auth（sk-xxx例示）」「skill」。実際のAPIキーなし |
| `Bearer` | 15件 | 全て変数展開 `Bearer ${...}` 形式のコードまたはプレースホルダー文字列。実トークン値なし |
| `password` | 複数 | 全て `type="password"` または `- API key input (password type)` のHTML/コメント記述。実パスワード値なし |
| `secret` | 複数 | `consumer_secret`（列名・変数名）、`channel_secret`（変数名）、`setup-secrets.sh`（ファイル名言及）等のコード。実際のシークレット値なし |
| `.env` | 複数 | `.gitignore` への追記、READMEの説明文、コードコメント。`.env` ファイルそのものはコミットなし |

### .envファイルのコミット有無
- `git log --all -p --diff-filter=D -- ".env" "**/.env"` の結果: **ヒットなし**
- `.env` ファイルが一度でもコミット・削除された記録は存在しない

### セキュリティ対策コミットの確認
- `0735b34`: `NEXT_PUBLIC_API_KEY` フォールバック削除（クライアントバンドルへのキー露出防止）
- `1165597`: 内部計画ドキュメント削除 + `wrangler.toml` の `WORKER_URL` をプレースホルダー化
- `c912318`: `.mcp.json`, `.x-harness-credentials.local`, `setup-secrets.sh` 等を `.gitignore` に追加
- `ac73974`: `.claude/` を `.gitignore` に追加

### git stash
- stashなし（空）

### git reflog
- HEAD@{2}: clone元（問題なし）
- HEAD@{1}: gitignoreのシークレットファイル追加（問題なし）
- HEAD@{0}: `.claude/` を gitignore 追加（問題なし）

---

## 2. dental-line-saas/line-harness-oss Git履歴

### コミット概要
- リモートURL: `https://github.com/Shudesu/line-harness-oss.git`
- **公開状態: PUBLIC（一般公開中）**
- 総コミット数: 12件（dental-saas拡張コミット含む）
- 現在のブランチ: `deploy/dental-saas`
- 現在のステータス: `.dev.vars.example`, `.env.example`, `.github/workflows/`, `README.md` 等の削除がステージング済み（機密情報非含）

### 機密情報検索結果

| 検索パターン | ヒット数（コミット数） | 詳細 |
|---|---|---|
| `sk-` | 1件（b08f643） | `Bearer sk-xxx` 例示文字列のみ。実APIキーなし |
| `Bearer` | 複数 | 全て変数展開またはプレースホルダー（`Bearer YOUR_API_KEY`等）。実トークンなし |
| `password` | 複数 | `type="password"` HTML属性のみ |
| `secret` | 複数 | 変数名・列名・コメント（`channel_secret`, `STRIPE_WEBHOOK_SECRET=whsec_your-stripe-webhook-secret` 等）。`whsec_your-stripe-webhook-secret` はプレースホルダー |
| `.env` | 複数 | `.gitignore` 記述、`.env.example`（プレースホルダーのみ）、コメント |

### .envファイルのコミット有無
- `.dev.vars.example` および `.env.example` がコミット済みだが、**内容は全てプレースホルダー**（`your_line_channel_secret`, `your-api-key` 等）
- 実際の認証情報は含まれていない

### git stash
- stashなし（空）

---

## 3. D1データベース（x-harness）

データベース名: `x-harness`  
データベースID: `[X_HARNESS_DB_ID]`

### x_accounts テーブル
- レコード数: 1件（ユーザー名: `TEDIT_officialX`）
- `access_token`: **存在する**（値は確認せず）
- `access_token_secret`: **存在する**（値は確認せず）
- `consumer_key`: **存在する**（値は確認せず）
- `consumer_secret`: **存在する**（値は確認せず）
- 評価: トークン類はDBに平文保存されているが、これはD1内部のデータであり、Git/公開リポジトリへの漏洩ではない。Cloudflare管理下のセキュアストレージ。ただし **暗号化されておらず平文保存** である点は留意事項。

### users テーブル
- レコード数: 0件（個人情報なし）

### settings テーブル
- レコード数: 1件
- キー: `auto_features_enabled`（機能フラグのみ）
- APIキー等の機密情報なし

### staff_members テーブル
- レコード数: 0件（個人情報なし）

### followers テーブル
- レコード数: 0件（個人情報なし）

---

## 4. リモートリポジトリ公開状況

| リポジトリ | リモートURL | 公開状況 |
|---|---|---|
| x-harness-oss | `https://github.com/Shudesu/x-harness-oss.git` | **PUBLIC** |
| line-harness-oss | `https://github.com/Shudesu/line-harness-oss.git` | **PUBLIC** |

両リポジトリとも一般公開中。Git履歴ごと誰でも閲覧可能な状態。

---

## 5. Cloudflare Workers シークレット管理

Worker名: `x-harness-worker`

| シークレット名 | 種別 | 評価 |
|---|---|---|
| `API_KEY` | `secret_text` | 適切（Wrangler Secret管理） |
| `X_ACCESS_TOKEN` | `secret_text` | 適切（Wrangler Secret管理） |
| `X_REFRESH_TOKEN` | `secret_text` | 適切（Wrangler Secret管理） |

`wrangler.toml` の `[vars]` セクションに機密情報なし。`WORKER_URL` のみ（パブリックURL、問題なし）。APIキー等はコメントアウトされた説明文のみ（`# Set via: wrangler secret put API_KEY`）。

---

## 6. 漏洩の痕跡

### git stash
- x-harness-oss: stashなし
- line-harness-oss: stashなし

### git reflog
- x-harness-oss: 3件のみ（clone + 2件のgitignore更新）。機密情報の痕跡なし
- line-harness-oss: 13件。dental-saas開発コミットとcloneのみ。機密情報の痕跡なし

---

## 漏洩判定サマリー

| # | 調査項目 | 漏洩有無 | 詳細 |
|---|---|---|---|
| 1 | x-harness-oss Git履歴（APIキー） | **なし** | 全てプレースホルダーまたは変数名 |
| 2 | x-harness-oss Git履歴（.envファイル） | **なし** | .envは一度もコミットされていない |
| 3 | x-harness-oss Git履歴（Bearerトークン実値） | **なし** | 全て変数展開またはプレースホルダー |
| 4 | line-harness-oss Git履歴（APIキー） | **なし** | .env.exampleはプレースホルダーのみ |
| 5 | line-harness-oss Git履歴（.envファイル） | **なし** | .env実ファイルはコミットなし |
| 6 | D1データベース x_accounts | **漏洩なし（注意事項あり）** | GitやWeb上への漏洩なし。D1内に平文保存されている点は留意 |
| 7 | D1データベース users/settings/staff_members/followers | **なし** | 機密情報・個人情報のレコードなし |
| 8 | Cloudflare Workers シークレット | **適切** | Wrangler Secretで管理。wrangler.tomlに実値なし |
| 9 | リモートリポジトリ公開状況 | **要注意（漏洩ではないが公開中）** | 両リポジトリとも PUBLIC。Git履歴に機密情報がないことを確認済みのため漏洩には該当しないが、今後の誤コミットリスクに注意 |
| 10 | git stash / reflog | **なし** | 機密情報の痕跡なし |

### 総合判定: **漏洩事実なし**

現時点で Git 履歴・公開リポジトリ・Cloudflare Workers 設定のいずれにおいても、実際の機密情報（APIキー・トークン・パスワード）の漏洩は確認されなかった。

### 継続的な注意事項（漏洩ではないが改善推奨）
1. **両リポジトリがPUBLIC**: OSS公開リポジトリとして意図的にPublicにしていると思われるが、誤コミット時のリスクは常時存在する。`.gitignore` は適切に整備済み
2. **x_accounts のトークン平文保存**: D1データベース内に OAuth トークンが平文保存されている。D1はCloudflareのマネージドサービスで外部からアクセス不可だが、アプリレベルでの暗号化（encrypt-at-rest）は未実装
3. **account_id の公開**: `wrangler.toml` に `account_id = "[CLOUDFLARE_ACCOUNT_ID]"` が含まれてGit管理されている。Cloudflareのaccount_idは直接の脆弱性ではないが、フィッシング・ソーシャルエンジニアリングの補助情報になりえる
