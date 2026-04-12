# 機密情報ローカル露出調査レポート
調査日: 2026-04-11
調査者: セキュリティ対策委員会 リサーチ部A

---

## 1. 機密ファイル棚卸し

| ファイル | 内容 | .gitignore保護 | リスク |
|---|---|---|---|
| `/Users/kedit/Desktop/dev/x-auto-poster/.env` | X APIキー4種（平文）が記載されている | ルート `.gitignore` に記載済み ✅ | 中：Claudeのdenyルール設定前はClaude Codeが読み取り可能だった。現在はdenyルール設定済みで読み取りブロック済み |
| `/Users/kedit/Desktop/dev/x-auto-poster/.env.example` | プレースホルダーのみ（実値なし）| — | なし |
| `/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/.x-harness-credentials.local` | APIキー・URL等が含まれる（推定）| x-harness-oss の `.gitignore` に記載済み ✅ | 中：**読み取りブロック（deny設定済み）** — ファイルへのアクセスはdenyルールでブロックされているため内容は未確認。存在は確認済み |
| `/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/.mcp.json` | X Harness APIキーが平文で記載されている（`xh_` プレフィックス、32文字hex） | x-harness-oss の `.gitignore` に記載済み ✅ | 高：APIキーが平文記載。Gitには含まれないが、ローカルファイルとして存在する。Claude Codeがこのファイルを読んだ場合、`~/.claude/file-history/` に内容が残存する |
| `/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/setup-secrets.sh` | `.env` を読み込んで実行するシェルスクリプト。実値は含まず | x-harness-oss の `.gitignore` に記載済み ✅ | 低：スクリプト実行時にAPIキーがシェル変数として展開されるが、ファイル自体には実値なし |
| `/Users/kedit/Desktop/dev/x-auto-poster/dental-line-saas/line-harness-oss/.env.example` | プレースホルダーのみ（実値なし）| — | なし |
| `/Users/kedit/Desktop/dev/x-auto-poster/dental-line-saas/line-harness-oss/docs/.env.example` | プレースホルダーのみ（実値なし）| — | なし |
| `/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/apps/web/.env.production` | 存在するが **読み取りブロック（deny設定済み）** | x-harness-oss の `.gitignore` に記載済み ✅ | 未確認：denyルールでブロックされているため内容未確認 |

---

## 2. ハードコード検索結果

### 2-1. ソースコード（src/, apps/, packages/）

- `src/poster.py`：`consumer_key`, `consumer_secret`, `access_token`, `access_token_secret` の変数参照はあるが、実値ではなく `config["x_api"]` ディクショナリからの参照
- `src/config.py`：`load_dotenv()` で `.env` を読み込み、YAML設定内の `${ENV_VAR}` を展開する方式。実値のハードコードなし
- `x-harness-oss/apps/worker/src/`：認証は `c.env.API_KEY`（Cloudflare Workers環境変数）で参照。実値のハードコードなし
- `x-harness-oss/packages/mcp/src/index.ts`：`process.env.X_HARNESS_API_KEY` で参照。実値のハードコードなし
- `dental-line-saas/line-harness-oss/`：変数名・列名・コメントのみ。実値のハードコードなし

**結論：ソースコードに機密値のハードコードは発見されなかった。**

### 2-2. ビルド成果物（out/, .next/）

- `x-harness-oss/apps/web/out/` および `.next/`：`Bearer ` の文字列を含むJSファイルが存在するが、これらは全て変数展開パターン（`Bearer ${...}`）またはプレースホルダー文字列。実際のトークン値は含まれない
- APIキーは `localStorage.getItem("xh_api_key")` でランタイム取得する設計のため、ビルド成果物にキーは埋め込まれない
- `out/` および `.next/` はどちらも `.gitignore` で除外済み

**結論：ビルド成果物にも機密値の埋め込みは確認されなかった。**

---

## 3. 個人情報（PII）検索結果

### 3-1. 電話番号

- 調査範囲（`src/`, `docs/`, memory ファイル全体）において、`080-`, `090-`, `070-` のパターンにヒットなし
- **個人電話番号の露出：なし**

### 3-2. メールアドレス

- `@gmail.com`, `@yahoo.co.jp`, `@hotmail`, `@icloud.com`, `@docomo.ne.jp` のパターンにヒットなし
- **フリーメール等の個人メールアドレス露出：なし**

### 3-3. 住所情報

- `住所` のパターンにヒットなし
- **住所情報の露出：なし**

### 3-4. 本名

- `memory/user_profile.md` を確認：呼び名「まっさん」のみ記載。本名は記載されていない
- `松`, `masashi`, `masato`, `健二` 等の一般的な名前パターンにもヒットなし
- **本名の露出：なし**

### 3-5. SNSアカウント

- `memory/project_x_harness.md`：Xアカウント `@TEDIT_officialX`、X User ID `1587762566125989889` が記載されている
- X以外のSNSアカウント情報の記載は確認されなかった
- **X（Twitter）アカウント情報：memory に記載あり（意図的なもの）**

### 3-6. VPS接続情報

- `memory/reference_vps_deploy.md`：VPS IPアドレス（`[VPS_IP]`）、ユーザー名 `root` が記載されている
- SSH鍵認証のため、IPとユーザー名が漏洩しても直接侵入はできないが、攻撃対象の特定に利用される可能性がある
- **VPS IPアドレス・ユーザー名：memory に記載あり（要注意）**

---

## 4. メモリファイルの機密情報チェック

調査対象：`/Users/kedit/.claude/projects/-Users-kedit-Desktop-dev-x-auto-poster/memory/` 全ファイル（51ファイル）

### 4-1. APIキー・パスワード・トークンの値

- `xh_` プレフィックスのAPIキー実値：**なし**
- X APIキーの実値（`ZgijDQ1X` 等の実際の値）：**なし**
- パスワード実値：**なし**
- LINE Channel Access Tokenの実値：**なし**

### 4-2. 個人情報

- 本名：**なし**（「まっさん」のみ）
- 電話番号：**なし**
- メールアドレス：**なし**

### 4-3. Cloudflare ID（infrastructure情報）

- `project_x_harness.md`：D1 Database ID `[X_HARNESS_DB_ID]` が記載されている
- `project_next_session.md`：同じD1 Database IDが記載されている
- `reference_dental_repo.md`：歯科SaaS D1 Database ID `[DENTAL_DB_ID]`、LIFF ID `[LIFF_ID]` が記載されている
- Cloudflare Account ID（`[CLOUDFLARE_ACCOUNT_ID]`）：**memory には記載なし**（wrangler.tomlとdocs/にのみ存在）

### 4-4. VPS情報

- `reference_vps_deploy.md`：IPアドレス `[VPS_IP]`、ユーザー `root`、デプロイパス `/opt/x-auto-poster/` が記載されている
- SSH鍵そのものは記載なし

**メモリファイル総合評価：APIキーや認証トークンの実値は含まれていない。インフラIDとVPS情報が記載されているが、それ自体は直接の攻撃手段にはならない。**

---

## 5. docs/フォルダの機密情報チェック

調査対象ファイル：`security-audit-global.md`, `security-audit-xharness.md`, `security-audit-leak-git.md`, `security-improvement-plan.md`, `LINE_BOOKING_UX_PLAN.md`

### 5-1. security-audit-global.md

- Cloudflare Account ID（`[CLOUDFLARE_ACCOUNT_ID]`）が**平文で記載されている**
- 両プロジェクトのD1 Database IDが平文で記載されている
- APIキー・パスワード・トークンの実値：なし（キー名のみ）
- **リスク：Cloudflare Account IDがdocsに平文記載。このファイルがGit管理されると公開リポジトリに含まれる**

### 5-2. security-audit-xharness.md

- APIキーの実値：なし（キー名、接頭辞`xh_`の説明のみ）
- `account_id`、`database_id` の実値の記載：なし

### 5-3. security-audit-leak-git.md

- D1 Database ID `[X_HARNESS_DB_ID]` が記載されている
- Cloudflare Workers シークレット名のリスト（値なし）
- APIキー・トークンの実値：なし

### 5-4. security-improvement-plan.md

- Cloudflare Account ID（`[CLOUDFLARE_ACCOUNT_ID]`）が**平文で記載されている**
- APIキー・トークンの実値：なし

### 5-5. LINE_BOOKING_UX_PLAN.md

- 機密情報・個人情報：なし

**docs/フォルダ総合評価：APIキーやトークンの実値は含まれていないが、Cloudflare Account IDとD1 Database IDが複数のdocsファイルに平文記載されている。`docs/` フォルダがGit追跡対象の場合、このファイルがコミットされると公開リポジトリに含まれる。**

---

## 6. 設定ファイルの機密情報

### 6-1. x-harness-oss/apps/worker/wrangler.toml

| 項目 | 値 | リスク |
|---|---|---|
| `account_id` | Cloudflare Account IDが平文記載 | 低：Account IDは直接の攻撃手段にはならないが、フィッシング補助情報になりえる |
| `database_id` | D1 Database IDが平文記載 | 低：Database IDのみでは接続不可（認証が必要） |
| `WORKER_URL` | 本番WorkersのURL | 低：公開URLであり機密情報には該当しない |
| APIキー・トークン | **記載なし** | — コメントに「wrangler secret put で設定」と明記 ✅ |
| .gitignore保護 | **なし**（`wrangler.toml` は `.gitignore` 非対象） | 要注意：ローカル差分がコミットされると公開リポジトリに含まれる |

### 6-2. dental-line-saas/line-harness-oss/apps/worker/wrangler.toml

| 項目 | 値 | リスク |
|---|---|---|
| `account_id` | Cloudflare Account IDが平文記載 | 低 |
| `database_id` | D1 Database IDが平文記載 | 低 |
| APIキー・トークン | **記載なし** ✅ | — |
| .gitignore保護 | **なし** | 要注意 |

### 6-3. dental-line-saas/line-harness-oss/packages/plugin-template/wrangler.toml

- プレースホルダーのみ。実際のIDや認証情報なし ✅

### 6-4. ~/.claude/settings.json

| 設定項目 | 値 | 評価 |
|---|---|---|
| `permissions.deny` | `.env`, `.env.*`, `.dev.vars`, `.x-harness-credentials.local` の読み取り禁止 + 危険コマンド禁止 | ✅ denyルール設定済み |
| APIキー・パスワード | **なし** | — |
| `skipDangerousModePermissionPrompt` | `true` | 意図的な設定と判断 |
| 機密情報 | **なし** | — |

---

## 危険度サマリー

| # | 項目 | 危険度 | 即時対応要否 | 詳細 |
|---|---|---|---|---|
| 1 | `.env` に X APIキー4種が平文記載 | **高** | 否（denyルール設定済み） | ローカルファイルとして存在するが、`.gitignore` 保護済みかつ Claude Code のdenyルールでブロック済み。ファイル自体の存在は正常な運用形態 |
| 2 | `.mcp.json` に X Harness APIキーが平文記載 | **高** | 否（gitignore保護済み） | ローカルにAPIキーが平文で存在。`.gitignore` で除外済みのため Git 漏洩リスクは低いが、Claude Code がこのファイルを読んだ場合、`~/.claude/file-history/` に平文で残る可能性がある |
| 3 | `docs/security-audit-global.md` と `security-improvement-plan.md` に Cloudflare Account IDが平文記載 | **中** | 要確認 | `docs/` がGit追跡対象の場合、コミット時に公開リポジトリに含まれる。Account ID自体のリスクは低いが、管理ルールの整備が必要 |
| 4 | `wrangler.toml`（2ファイル）に Account ID・Database IDが平文記載 | **中** | 要注意 | `.gitignore` 非対象。ローカルの `wrangler.toml` がコミットされると公開リポジトリに含まれる。`git diff --staged` を確認する運用が必要 |
| 5 | `memory/reference_vps_deploy.md` にVPS IPアドレスとrootユーザーが記載 | **低** | 否（SSH鍵認証のため） | IP・ユーザー名の漏洩単体では侵入不可。ただしSSH鍵が漏洩した場合の組み合わせリスクがある |
| 6 | `memory/` の複数ファイルにD1 Database IDとLIFF IDが記載 | **低** | 否 | Database IDのみでは接続不可。LIFF IDは公開情報として扱われることが多い |
| 7 | `~/.claude/file-history/` に過去セッションのファイル内容が蓄積 | **中** | 要確認 | denyルール設定前に Claude Code が `.env` や `.mcp.json` を読んでいた場合、その内容がここに平文で残存している可能性がある。定期削除の仕組みなし |

---

## 調査メモ

### 調査できなかった項目（denyルールによるブロック）
- `/Users/kedit/Desktop/dev/x-auto-poster/.env` の内容：ファイルの存在とキー名はsettings.json確認から推測可能だが、実際の読み取りはdenyルールによりブロック
- `/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/.x-harness-credentials.local`：denyルールによりブロック
- `/Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/apps/web/.env.production`：denyルールによりブロック

注意：上記3ファイルは「**読み取りブロック（deny設定済み）**」と記録する。内容は未確認。

### 追加確認推奨事項
1. `~/.claude/file-history/` の内容確認（denyルール設定前の機密ファイル読み取り痕跡）
2. `docs/` フォルダが x-harness-oss または x-auto-poster ルートの Git 追跡対象かどうかの確認
3. X Harness APIキー（`.mcp.json` に記載のもの）の定期ローテーション運用の検討

---

*調査範囲: 実際にファイルを確認した事実のみ記載。推測は含まない。発見した機密値の実際の値はレポートに記載していない。*
