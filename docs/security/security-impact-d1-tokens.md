# D1 OAuthトークン暗号化 影響調査レポート
調査日: 2026-04-11

---

## 現状のトークン使用フロー

### x_accountsテーブルのスキーマ（平文保存カラム）

`packages/db/schema.sql` (L5〜18) および `packages/db/migrations/001-oauth1a-columns.sql` より:

```
x_accounts テーブル
  - access_token TEXT NOT NULL       ← OAuth2 Bearer Token または OAuth1.0a アクセストークン
  - refresh_token TEXT               ← OAuth2 リフレッシュトークン（未使用の可能性あり）
  - consumer_key TEXT                ← OAuth1.0a Consumer Key（= X_API_KEY）
  - consumer_secret TEXT             ← OAuth1.0a Consumer Secret（= X_API_SECRET）
  - access_token_secret TEXT         ← OAuth1.0a Access Token Secret
```

合計4〜5種のクレデンシャルが平文でD1に保存されている。

### Cronジョブ（1日5回）でのトークン読み取り

`apps/worker/src/index.ts` L124〜189 の `scheduled()` 関数:

1. **L124**: `getXAccounts(env.DB)` → D1から全アカウントを `SELECT * FROM x_accounts` で取得
2. **L129〜137**: OAuth1.0a設定があればOAuth1クライアント、なければBearerトークンでXClientを構築
   ```typescript
   const xClient = account.consumer_key && account.consumer_secret && account.access_token_secret
     ? new XClient({ type: 'oauth1', consumerKey: account.consumer_key, ... })
     : new XClient(account.access_token);
   ```
3. **L139〜143**: `processEngagementGates()` と `processScheduledPosts()` にXClientを渡す
4. **L146〜169**: フォロワースナップショット記録時にも同様にXClientを構築
5. **L175〜188**: ステップシーケンス処理でも同様のXClient構築パターン

### APIルートでのトークン読み取り箇所

| ファイル | 関数/エンドポイント | 行 | 用途 |
|---|---|---|---|
| `apps/worker/src/routes/posts.ts` | `buildXClient()` helper | L10〜19 | 全投稿操作の共通ヘルパー |
| `apps/worker/src/routes/posts.ts` | `POST /api/posts` | L27 | 即時投稿 |
| `apps/worker/src/routes/posts.ts` | `DELETE /api/posts/:tweetId` | L121 | ツイート削除 |
| `apps/worker/src/routes/posts.ts` | `POST /api/posts/thread` | L139 | スレッド投稿 |
| `apps/worker/src/routes/posts.ts` | `GET /api/posts/history` | L169 | ツイート履歴取得 |
| `apps/worker/src/routes/posts.ts` | `GET /api/posts/mentions` | L194 | メンション取得 |
| `apps/worker/src/routes/posts.ts` | `POST /api/posts/:id/reply` | L337 | リプライ投稿 |
| `apps/worker/src/routes/posts.ts` | `GET /api/x-accounts/:id/subscription` | L351 | プラン確認 |
| `apps/worker/src/routes/posts.ts` | `POST /api/media/upload` | L394 | メディアアップロード |
| `apps/worker/src/routes/posts.ts` | `POST /api/posts/:id/like` | L413 | いいね |
| `apps/worker/src/routes/posts.ts` | `POST /api/posts/:id/retweet` | L430 | リツイート |
| `apps/worker/src/routes/x-accounts.ts` | `POST /api/x-accounts/:id/snapshot` | L126 | フォロワー記録 |
| `apps/worker/src/services/post-scheduler.ts` | `processScheduledPosts()` | L4〜25 | 予約投稿処理（Cron） |

### XClientへのトークン渡し方

`packages/x-sdk/src/client.ts` L296〜326 の `request()` メソッド:

- OAuth1の場合: `buildOAuth1Header()` にconsumerKey/consumerSecret/accessToken/accessTokenSecretを渡しHMAC-SHA1署名を生成
- Bearerの場合: `Authorization: Bearer {access_token}` ヘッダーに直接セット

---

## 暗号化した場合の影響

| 影響箇所 | 内容 | 稼働リスク |
|---|---|---|
| `packages/db/src/x-accounts.ts` `getXAccounts()` | トークン取得後に復号処理を追加する必要あり | 中（改修必須） |
| `packages/db/src/x-accounts.ts` `getXAccountById()` | 同上 | 中（改修必須） |
| `packages/db/src/x-accounts.ts` `createXAccount()` | 保存前に暗号化処理を追加する必要あり | 中（改修必須） |
| `packages/db/src/x-accounts.ts` `updateXAccount()` | トークン更新時の暗号化が必要 | 中（改修必須） |
| `apps/worker/src/index.ts` `scheduled()` L124 | getXAccountsの戻り値が復号済みになっていれば変更不要 | 低（DBレイヤー対応で吸収可） |
| 全APIルートの `buildXClient()` 呼び出し | DBレイヤーで復号済みなら変更不要 | 低（DBレイヤー対応で吸収可） |
| 暗号化キーの管理 | Wrangler Secretで `TOKEN_ENCRYPTION_KEY` を追加管理が必要 | 中（キー漏洩時は全トークン危険） |
| `wrangler.toml` の `Env` 型定義 | `TOKEN_ENCRYPTION_KEY` を `Bindings` に追加する必要あり | 低 |

### レイテンシへの影響
AES-256-GCM復号はCrypto APIを使用した非同期処理で完了する。1アカウントあたり5回の復号（getXAccounts呼び出し1回 + フィールド数）で計算しても、Worker実行時間への影響は1ms未満と見込まれる。**Cron実行の5回/日への影響は実質ゼロ。**

### OAuth Token Refreshフローへの影響
現在のコードを調査した結果、`refresh_token` カラムは定義されているが、**自動リフレッシュロジックはWorkerコード内に存在しない**（手動で `PUT /api/x-accounts/:id` を呼んでトークンを更新する運用）。暗号化対応後は `updateXAccount()` での保存時に暗号化が必要となるが、Cron実行中にトークンが自動更新されることはないため、**予約投稿17件への影響はない。**

### 予約投稿17件（04/11〜04/17）への影響
移行作業中にWorkerが停止しない限り影響なし。ただし**移行手順として**:
1. 新しい暗号化コードをDeployした瞬間に既存の平文トークンを読もうとすると復号エラーになる
2. そのため「既存平文は平文として読む、暗号化済みは復号する」の後方互換フラグが必要
3. または**メンテナンス時間内**（Cron実行のない時間帯）で: 旧トークン退避→暗号化して上書き→新コードDeploy の順で実施する必要あり

---

## 対応しない場合のリスク

### D1データベースのアクセス権限

Cloudflare D1のアクセス経路は以下の2つのみ:

1. **Cloudflare Dashboard** — Cloudflareアカウントにログインしたユーザーのみ閲覧可能
2. **Wrangler CLI** — `wrangler d1 execute` コマンド（Cloudflare認証が必要）

外部から直接D1にSQLアクセスする手段はない（D1はHTTP APIを公開していない）。

### 実際のリスク評価

| リスク要因 | 評価 | 理由 |
|---|---|---|
| 外部からの直接D1アクセス | 極低 | D1はCloudflareアカウント認証が必須。外部公開APIなし |
| Cloudflareアカウント侵害 | 中 | Cloudflareアカウントが乗っ取られた場合はD1閲覧可能 |
| Worker経由のトークン漏洩 | 低 | APIレスポンスには `serialize()` 関数でトークンを除外済み（`x-accounts.ts` L8〜17） |
| CloudflareのインフラレベルD1アクセス | 低〜中 | SaaS型DBのため運営側はアクセス可能（利用規約の問題） |
| ログ・デバッグ出力への混入 | 低 | コード上、トークンをconsole.logする箇所は確認されず |

**総合リスクレベル: 低〜中**
主な前提は「Cloudflareアカウントが安全であること」。MFAが有効であれば現状のリスクは許容範囲内と判断できる。ただしOSSとして公開されているコードベースであり、D1にトークンを平文保存していることは設計上の懸念点として残る。

---

## 推奨対応

### 選択肢A: D1トークン暗号化（AES-256-GCM）
**難易度: 中 / 停止リスク: 中（移行手順に注意）**

- Wrangler Secretに `TOKEN_ENCRYPTION_KEY` を追加
- `packages/db/src/x-accounts.ts` の read/write箇所に暗号化/復号処理を追加
- 移行時は平文→暗号化済みの一括変換スクリプトを実行（Cron停止前に実施）
- メリット: Cloudflareアカウント侵害時もトークンは即座に使えない
- デメリット: 実装コスト、キー管理の複雑化、移行リスク

### 選択肢B: Cloudflareアカウントのセキュリティ強化（即効・ゼロ停止リスク）
**難易度: 低 / 停止リスク: ゼロ**

- Cloudflareアカウントに**ハードウェアMFAキー（YubiKey等）**を設定
- APIトークンのスコープを最小権限（D1: Read/Write のみ）に絞る
- Cloudflare Access でDashboardアクセスをIP制限
- メリット: コード変更不要、即日対応可能、根本的な侵入経路を防ぐ
- デメリット: D1自体が平文のまま（内部インフラレベルのアクセスには無防備）

### 選択肢C: 機密トークンをWrangler Secretに移行（D1から外す）
**難易度: 中 / 停止リスク: 低**

- `consumer_secret` と `access_token_secret` の2つをD1から削除し、Wrangler Secretへ移行
- D1には `consumer_key` と `access_token` のみ残す（これだけでは署名不可）
- Worker起動時に `env.CONSUMER_SECRET` / `env.ACCESS_TOKEN_SECRET` を使用
- メリット: 最重要の署名鍵がD1に残らない。Secretは暗号化されてWorkerメモリにのみ展開
- デメリット: マルチアカウント対応が困難（Secretは1セットのみ）。現在の1アカウント運用なら問題なし

---

## 調査サマリー

現状、**D1へのアクセスはCloudflareアカウント認証で守られており、外部からの直接アクセス手段は存在しない**。Workerのレスポンスからもトークンは除外されている（`serialize()` 関数）。

**即時推奨**: 選択肢B（Cloudflareアカウントのセキュリティ強化）を先行実施。コード変更なし、停止リスクゼロで最大の防御効果が得られる。

**中期推奨**: 選択肢C（consumer_secret/access_token_secretをWrangler Secretへ）を実施。1アカウント運用の現状に最適で、最重要クレデンシャルをD1から排除できる。

**現在の予約投稿17件（04/11〜04/17）への影響**: 選択肢Bは影響ゼロ。選択肢CはCron実行のない時間帯（例: JST午前2〜5時）に実施すれば影響ゼロ。
