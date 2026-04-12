# リポジトリ公開状況 影響調査レポート
調査日: 2026-04-11

---

## リポジトリ一覧

| リポジトリ | オーナー | GitHub URL | 公開状態 | push有無 | ライセンス |
|---|---|---|---|---|---|
| x-harness-oss | Shudesu（まっさん） | github.com/Shudesu/x-harness-oss | PUBLIC | あり（ローカル2コミットをpush済み） | MIT |
| line-harness-oss | Shudesu（まっさん） | github.com/Shudesu/line-harness-oss | PUBLIC | あり（ローカル11コミットをpush済み） | なし |

### push状況の詳細

**x-harness-oss:**
- `git log origin/main..HEAD` で2コミットがpush済みであることを確認
- `security: add .claude/ to gitignore`（本日）
- `chore: update .gitignore to exclude local secret files`（本日）

**line-harness-oss:**
- ローカルの全コミット（dental SaaSフィーチャー含む11コミット）がpush済み
- リモートは `Shudesu/line-harness-oss`（まっさん自身のリポジトリ）

---

## 公開内容の安全性チェック

### x-harness-oss

| チェック項目 | 状態 | 詳細 |
|---|---|---|
| APIキー・トークン（現在のHEAD） | 安全 | `.dev.vars.example`にプレースホルダのみ。実値なし |
| database_id（現在のHEAD） | **要注意** | `wrangler.toml`に実際のD1 database_idが記載されている |
| database_id（コミット履歴） | **危険** | コミット `a42f6b0` で実際の値が追加され、現在も最新HEADに残っている。git logでの全履歴スキャンでも同値が複数コミットで確認された |
| account_id | 安全 | `wrangler.toml`にaccount_idフィールドなし |
| `.env`ファイル | 安全 | `.gitignore`で除外済み、HEADに存在しない |
| デプロイ先URL | 公開情報 | `https://x-harness-worker.workers.dev`（WORKER_URL変数として記載。Workersのデフォルトドメインのため低リスク） |
| GitHub Actions / Secrets | なし | GitHub Actionsワークフローなし |

**具体的な漏洩内容:**
- `apps/worker/wrangler.toml` に D1 database_id の実値がコミットされている
- この値はコミット `a42f6b0`（2026-03-26）以降の全履歴に存在し、PRIVATEに変更しても履歴から削除されるわけではない（git rewriteが必要）

### line-harness-oss

| チェック項目 | 状態 | 詳細 |
|---|---|---|
| APIキー・トークン（現在のHEAD） | 安全 | `.dev.vars.example`にプレースホルダのみ |
| database_id（現在のHEAD） | 安全 | `YOUR_DEV_D1_DATABASE_ID` プレースホルダのみ |
| account_id（現在のHEAD） | 安全 | `YOUR_DEV_ACCOUNT_ID` プレースホルダのみ |
| コミット履歴 | 安全 | 全履歴をスキャンしたが実値なし |
| `.env`ファイル | 安全 | `.gitignore`で除外済み |
| デプロイ連携 | GitHub Actions | `.github/workflows/deploy-worker.yml`が存在。`CLOUDFLARE_API_TOKEN`と`CLOUDFLARE_ACCOUNT_ID`はGitHub Secretsから取得しており、コードに実値なし |
| dental SaaS コード | **確認事項** | ローカルで追加したdental SaaS関連コード（11コミット）がpushされている。このコードに個人情報・機密情報が含まれていないか別途確認推奨 |

---

## GitHubリポジトリの利用状況

| リポジトリ | Stars | Forks | 利用者影響度 |
|---|---|---|---|
| x-harness-oss | 27 | 5 | 低〜中（forkしている5人が独自カスタマイズ中の可能性） |
| line-harness-oss | 354 | 165 | **高**（165フォーク。多数のユーザーが利用中） |

---

## PRIVATE変更時の影響

### Cloudflare Workersデプロイへの影響

| 項目 | 影響 |
|---|---|
| x-harness-oss | **影響なし**。デプロイはローカルの`wrangler deploy`コマンドで実行しており、GitHubとの連携なし |
| line-harness-oss | **影響あり**。`.github/workflows/deploy-worker.yml`がGitHub ActionsのCI/CDを使用。PRIVATEに変更後もGitHub Actionsは動作するが、外部forkからのPRによる自動デプロイが制限される |

### OSSライセンス上の義務

| リポジトリ | 現在のライセンス | PRIVATE変更時の義務 |
|---|---|---|
| x-harness-oss | MIT License | **MITは「プライベート化を禁止しない」**。既に公開済みのコードのforkには引き続きMITが適用されるが、新規の非公開化は法的に問題なし |
| line-harness-oss | ライセンスなし | 制約なし。いつでもPRIVATEに変更可能 |

### 既存フォーカーへの影響

- **x-harness-oss（5 forks）**: PRIVATEに変更すると、フォーク先はそのまま存続するが、上流リポジトリへのアクセス・sync・PRが不可になる。少数のため影響は限定的
- **line-harness-oss（165 forks）**: PRIVATEに変更すると、165のフォーク全てが上流との接続を失う。既に稼働中のforkは動き続けるが、新規クローン・sync・issueが不可になる。**影響が大きい**

---

## PRIVATEに変更しない場合のリスク

### x-harness-oss の具体的リスク

1. **D1 database_id の公開**
   - 攻撃者が得られる情報: Cloudflare D1のdatabase ID（UUID形式）
   - 実害シナリオ: database_id単体ではD1に直接アクセスする手段はない。ただし、Cloudflare APIトークンと組み合わせた場合、該当D1へのアクセスが可能になる。「database_id公開 + APIトークン窃取」の2段階攻撃で実害に至る
   - リスクレベル: **中**（database_id単体では攻撃成立しない。ただし漏洩情報として記録されることはリスク）

2. **Worker URLの公開**
   - 攻撃者が得られる情報: WorkerのエンドポイントURL
   - 実害シナリオ: APIキー認証があるため、URL知得だけでは操作不可。ただしDDoS攻撃やスキャンの標的になりやすい
   - リスクレベル: **低**（認証があれば問題なし）

3. **システム構造の公開**
   - 攻撃者が得られる情報: APIルート・データベーススキーマ・認証方式
   - 実害シナリオ: 既知のルート・スキーマを参考に脆弱性探索が容易になる
   - リスクレベル: **低**（OSSとして公開しているため想定内）

### line-harness-oss の具体的リスク

1. **システム構造・Webhook設計の公開**
   - LINEのWebhook処理ロジックが公開されているため、LINE Channel Secretが漏洩した場合のなりすましが容易になる
   - リスクレベル: **低**（Secretが漏洩しない限り問題なし）

2. **dental SaaS コードの公開**
   - ローカルで追加した歯科SaaS関連コードが公開されている（11コミット）
   - このコードに医院名・URL・個人情報等が含まれていた場合、プライバシーリスク
   - リスクレベル: **要確認**（コードの内容次第）

---

## 推奨対応（3つの選択肢）

### 選択肢A: x-harness-ossのみPRIVATE化 + database_idをgit履歴から削除

- **内容**: x-harness-ossをPRIVATEに変更し、`git filter-repo`でdatabase_idをコミット履歴から消去してforce push
- **メリット**: 最も安全。database_idの漏洩リスクを完全に排除
- **デメリット**: 
  - Stars 27・Forks 5のユーザーへの影響
  - git rewriteは不可逆な操作（実行前に必ずまっさんの承認が必要）
  - line-harness-ossの165 forksは維持されるため、こちらのリスクは残る
- **優先度**: 高（database_id漏洩の早期対処として）

### 選択肢B: database_idを差し替えてプレースホルダに戻す（PRIVATE化しない）

- **内容**: x-harness-ossの`wrangler.toml`のdatabase_idをプレースホルダに書き戻してcommit。現在の公開状態を維持
- **メリット**: 
  - 既存ユーザーへの影響ゼロ
  - OSSとしての価値を維持
  - git filter-repoなどの不可逆操作が不要
- **デメリット**: 
  - 過去のコミット履歴にはdatabase_idが残る（GitHub上でcommit hashで参照可能）
  - 完全な漏洩リスク排除にはならない
- **優先度**: 中（完全対策ではないが即時実施可能）

### 選択肢C: 両リポジトリをPRIVATE化（現状維持でリスク許容）

- **内容**: 両リポジトリをPRIVATEに変更し、OSSとしての公開を終了
- **メリット**: 新規の情報漏洩リスクを最小化。line-harness-ossの165 forksへの上流提供を停止できる
- **デメリット**: 
  - line-harness-ossは165 forks・354 starsと利用者が多い。PRIVATEにすると既存ユーザーからの強い反発が予想される
  - ライセンス上は問題ないが、コミュニティ信頼を失うリスク
  - database_idは履歴に残るため、完全対策には別途git rewriteが必要
- **優先度**: 低（影響度とリスクのバランスが悪い）

---

## リサーチ部からの所見

最も緊急度が高いのは **x-harness-ossのD1 database_id漏洩**。現在のHEADおよびコミット履歴の両方に実値が記録されており、GitHubが公開リポジトリである限り誰でも参照可能。database_id単体で直接攻撃は成立しないが、追加情報との組み合わせでリスクが増大するため、早期対処を推奨。

line-harness-ossについては現時点で機密情報の漏洩は確認されていないが、dental SaaSコード（11コミット）の内容確認と、PRIVATE化の検討を推奨。

---

*調査者: リサーチ部*
*調査範囲: ローカルgitリポジトリのコミット履歴 + GitHub APIによるリポジトリメタデータ*
