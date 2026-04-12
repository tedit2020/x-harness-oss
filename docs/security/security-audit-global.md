# グローバル＆歯科SaaS セキュリティ監査レポート
調査日: 2026-04-11

---

## A. Claude Code グローバル設定

### 1. settings.json

ファイルパス: `/Users/kedit/.claude/settings.json`

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "enabledPlugins": { ... },
  "extraKnownMarketplaces": { ... },
  "showThinkingSummaries": true,
  "skipDangerousModePermissionPrompt": true,
  "effortLevel": "high"
}
```

**確認結果:**

- `permissions.deny` キー: **未設定**（denyルールなし）
- `.env` ファイルへのアクセス禁止ルール: **未設定**
- 危険なコマンド（rm -rf, git push --force等）の禁止ルール: **未設定**
- `skipDangerousModePermissionPrompt: true` が設定されている → 危険なモードでの権限確認プロンプトをスキップする設定。これは通常の使用では許可確認ダイアログをバイパスする可能性がある。

### 2. プロジェクト別設定

対象ディレクトリ:
- `/Users/kedit/.claude/projects/-Users-kedit/`
- `/Users/kedit/.claude/projects/-Users-kedit-Desktop-dev/`
- `/Users/kedit/.claude/projects/-Users-kedit-Desktop-dev-x-auto-poster/`
- `/Users/kedit/.claude/projects/-Users-kedit-dev/`

**確認結果:** 4プロジェクトディレクトリいずれにも `settings.json` が存在しない。プロジェクト別の deny ルールは**設定なし**。

### 3. file-history（非暗号化バックアップ）

パス: `~/.claude/file-history/`

**確認結果:**
- ディレクトリは**存在する**
- セッションディレクトリ数: 35個
- 総ファイル数: **885ファイル**
- 合計サイズ: **8.3MB**
- 最大セッション（bd1b0755）: 81ファイル
- ファイル形式: UTF-8テキスト（平文）、暗号化なし
- ファイル名: ハッシュ値（例: `11793ed3aa0ee716@v1`）

**サンプル確認:** 1ファイルを確認したところ、Claude Codeの記憶ファイル（MEMORY.mdのコンテンツ）が平文で保存されていた。会話中にClaude Codeが読み書きしたファイルのバックアップが蓄積されている。.envファイルを読んだ場合、その内容もここに平文で残る可能性がある。

**定期削除の有無:** 確認できず（自動削除の設定は見当たらない）。

### 4. サンドボックスモード

**確認結果:** `settings.json` に `dangerouslyDisableSandbox` の記載はなし。ただし `skipDangerousModePermissionPrompt: true` が設定されており、危険操作の権限プロンプトがスキップされる。サンドボックスの明示的な有効化設定は確認できない。

---

## B. 歯科SaaS

### 1. プロジェクトの存在確認

- `/tmp/line-harness-fresh/`: **存在しない**（/tmpにはこのディレクトリなし）
- `/tmp/` に存在するのは `adobegc.log`、`claude-501`、`com.apple.launchd.*`、`powerlog` 等のみ
- 歯科SaaSコードの実際の場所: `/Users/kedit/Desktop/dev/x-auto-poster/dental-line-saas/line-harness-oss/`

### 2. .envファイルの状態

- `dental-line-saas/line-harness-oss/.env`: **存在しない**
- `dental-line-saas/line-harness-oss/.env.example`: **存在する**

`.env.example` に定義されているキー名（値なし）:
```
API_KEY
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
LINE_LOGIN_CHANNEL_ID
LINE_LOGIN_CHANNEL_SECRET
WORKER_URL
LIFF_URL
STRIPE_WEBHOOK_SECRET
X_HARNESS_URL
NEXT_PUBLIC_API_URL
LINE_HARNESS_API_URL
LINE_HARNESS_API_KEY
LINE_HARNESS_ACCOUNT_ID
```

### 3. .gitignore の状態

`dental-line-saas/line-harness-oss/.gitignore` に以下が含まれている（正常）:
```
.env
.env.local
.env.production
.env.staging
node_modules/
dist/
.next/
.wrangler/
.vercel/
.mcp.json
*.toml.bak
apps/web/out/
apps/worker/dist/
```

**評価:** .envの除外は適切に設定されている。

### 4. wrangler.toml の機密情報チェック

**dental-line-saas/line-harness-oss/apps/worker/wrangler.toml:**
```toml
account_id = "[CLOUDFLARE_ACCOUNT_ID]"
database_id = "[DENTAL_DB_ID]"
```

**x-harness-oss/apps/worker/wrangler.toml:**
```toml
account_id = "[CLOUDFLARE_ACCOUNT_ID]"
database_id = "[X_HARNESS_DB_ID]"
```

- `account_id`（Cloudflare Account ID）とD1 `database_id` が平文でコミットされている
- 両ファイルとも git にコミット済み（git log で確認）
- APIキー・シークレット・トークン類はなし（`wrangler secret put` コマンドで設定する正しい運用）

**評価:** Cloudflare Account IDとDatabase IDは低リスクだが、公開リポジトリ化する場合は要注意。

### 5. ソースコードのハードコード検索

対象: `.ts` ファイル（node_modules除外）

検索パターン: `sk-`、`Bearer [実際のトークン]`、`password=`、`secret=` 等

**結果: ハードコードされた機密情報は検出されなかった。**

### 6. x-harness-oss の機密ファイル確認

`.gitignore` 対象だが実際にローカルに存在するファイル:

| ファイル | 存在 | git追跡 |
|---|---|---|
| `setup-secrets.sh` | あり | なし（gitignore適用） |
| `setup-auto.mjs` | あり | なし（gitignore適用） |
| `.x-harness-credentials.local` | あり | なし（gitignore適用） |

`.x-harness-credentials.local` に含まれるキー名:
```
API_KEY
WORKER_URL
ADMIN_URL
X_USERNAME
X_USER_ID
```

**評価:** .gitignoreは機能している。ローカルにのみ存在し、gitには追跡されていない。ただし `file-history` に取り込まれる可能性がある（Claude Codeがこれらのファイルを読んだ場合）。

---

## C. 運用指針チェックリスト突合

| # | チェック項目 | 状態 | 備考 |
|---|---|---|---|
| 1 | settings.json で .env 読み込み禁止設定が完了しているか | **未設定** | `permissions.deny` ルールがない。.envを読めてしまう |
| 2 | サンドボックスモードが有効か | **不明/要確認** | `skipDangerousModePermissionPrompt: true` が設定されており、むしろ許可ダイアログがスキップされる設定になっている |
| 3 | CLAUDE.md にセキュリティルールが記載されているか | **記載あり** | `/Users/kedit/Desktop/dev/x-auto-poster/CLAUDE.md` に「安全ルール」として記載済み |
| 4 | ~/claude/file-history の非暗号化バックアップを定期削除しているか | **未実施** | 35セッション・885ファイル・8.3MBが蓄積。定期削除の仕組みなし |

---

## リスク一覧

| # | リスク | 深刻度 | 詳細 |
|---|---|---|---|
| 1 | settings.json に deny ルールが一切設定されていない | **高** | Claude Codeが .env ファイルを読んだ場合、その内容が file-history に平文で残る。現状では Claude Code は .env を含む任意のファイルにアクセス可能 |
| 2 | file-history が平文で蓄積・無期限保存されている | **高** | 885ファイル/8.3MB が `~/.claude/file-history/` に非暗号化で蓄積。過去セッションで読んだ機密ファイルの内容がここに残存している可能性がある。定期削除の仕組みがない |
| 3 | `skipDangerousModePermissionPrompt: true` が設定されている | **中** | 危険モードの権限確認プロンプトをスキップする設定。意図的なものであれば問題ないが、誤操作時のガードが弱まる |
| 4 | wrangler.toml に Cloudflare Account ID が平文コミットされている | **低** | `account_id = "[CLOUDFLARE_ACCOUNT_ID]"` が両プロジェクトのgitにコミット済み。Account IDが漏洩しても直接的な被害は限定的だが、攻撃の足がかりになる可能性がある |
| 5 | `.x-harness-credentials.local` がローカルに存在する | **低** | git追跡外で適切に管理されているが、Claude Codeが過去に読んでいた場合、file-historyに内容が残る可能性がある |

---

## 推奨アクション（優先度順）

1. **【高優先】settings.json に deny ルールを追加する**
   ```json
   "permissions": {
     "deny": [
       "Read(**/.env)",
       "Read(**/.env.local)",
       "Read(**/.env.production)",
       "Read(**/.x-harness-credentials.local)",
       "Bash(rm -rf *)",
       "Bash(git push --force*)"
     ]
   }
   ```

2. **【高優先】file-history の定期削除を設定する**
   - 現在 885 ファイル/8.3MB が平文蓄積中
   - 月次または週次での手動削除を運用ルール化する
   - `~/.claude/file-history/` 内の古いセッションを定期的にクリーンアップ

3. **【中優先】`skipDangerousModePermissionPrompt` の意図を確認する**
   - 意図的な設定であればコメントを残す
   - 不要であれば `false` に変更する

4. **【低優先】wrangler.toml の Account ID を環境変数化する**
   - 将来的にOSS公開する場合はプレースホルダーに変更することを検討
