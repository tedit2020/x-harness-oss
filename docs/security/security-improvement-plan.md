# セキュリティ改善計画
作成日: 2026-04-11
基準文書: クロードコード セキュリティ運用指針
作成者: ファクトチェック部（セキュリティ対策委員会）

---

## ファクトチェック結果（監査レポートの事実検証）

### 検証済み事項（正確）
- `.gitignore` の変更が x-harness-oss でコミット未完了: `git status` で ` M .gitignore` を確認 ✅
- `settings.json` に `permissions.deny` ルールが未設定: ファイル直読みで確認 ✅
- `skipDangerousModePermissionPrompt: true` が設定中: ファイル直読みで確認 ✅
- `~/.claude/file-history/` が 35セッション/8.3MB 蓄積: `du -sh` で確認 ✅
- `setup-secrets.sh` の 103 行目に `echo "  API Key:     $API_KEY"` が存在: ファイル直読みで確認 ✅
- x-harness-oss の git HEAD に account_id は含まれない（プレースホルダーのみ）: `git show HEAD` で確認 ✅

### 事実の修正（レポートBとの差異）
- **グローバル監査レポート「4. wrangler.toml の機密情報チェック」に誤りあり**
  - レポートの記載:「dental-line-saas の wrangler.toml に `account_id = "[CLOUDFLARE_ACCOUNT_ID]"` が git にコミット済み」
  - 実際の HEAD 内容: `account_id = "YOUR_DEV_ACCOUNT_ID"`（プレースホルダー）
  - 結論: **両プロジェクトともに git 履歴上に実際の account_id はコミットされていない。ローカルファイルにのみ存在する状態と判断する**
  - ※ ただし dental-line-saas のローカル wrangler.toml には実際の account_id が記載されている可能性があり、ローカルファイルの取り扱いには引き続き注意が必要

---

## チェックリスト突合結果

| # | チェック項目 | 現状 | 判定 |
|---|---|---|---|
| 1 | settings.json 等で .env ファイル等の読み込み禁止設定が完了しているか | `permissions.deny` キーが `settings.json` に存在しない。.env を含む任意のファイルへのアクセスが可能 | ❌ 未対応 |
| 2 | サンドボックスモードが有効、または有効化の手順が周知されているか | `skipDangerousModePermissionPrompt: true` が設定されており、危険操作の確認プロンプトがスキップされる設定になっている。サンドボックスの明示的な有効化はなし | ⚠️ 一部対応（要確認） |
| 3 | プライバシー設定で「データの学習利用」がオフになっているか | `settings.json` に該当設定キーなし。Claude Code の UI 設定での確認が必要（ファイルでは判断不可） | ⚠️ 一部対応（要手動確認） |
| 4 | セッション開始時に CLAUDE.md のセキュリティルールが読み込まれているか | `/Users/kedit/Desktop/dev/x-auto-poster/CLAUDE.md` に「安全ルール」セクションあり。Claude Code はプロジェクトルートの CLAUDE.md を自動読み込みするため対応済み | ✅ 対応済み |
| 5 | 実装前にテストコードを作成させ、品質と安全性を検証するフローを遵守しているか | CLAUDE.md に明文化なし。運用ルールとして確立されているか不明 | ⚠️ 一部対応 |
| 6 | トークン使用量を確認し、適宜 /clear と進捗出力によるリセットを行っているか | 設定・ドキュメントからは確認不可（運用習慣の問題） | ⚠️ 一部対応（運用依存） |
| 7 | ~/claude/file-history の非暗号化バックアップを定期的に削除しているか | 35セッション/885ファイル/8.3MB が蓄積。定期削除の仕組みは確認できない | ❌ 未対応 |
| 8 | AI が提示する「確認画面」の内容を、思考停止せずに精査しているか | 設定・ドキュメントからは確認不可（運用習慣の問題）。`skipDangerousModePermissionPrompt: true` によって確認機会自体が減っている可能性あり | ⚠️ 一部対応 |

---

## Phase 1: 即時対応（運用影響なし）

### 1-1. x-harness-oss の .gitignore 変更をコミットする

- **何を:** x-harness-oss の `.gitignore` への変更（`.mcp.json`、`.x-harness-credentials.local` 等の追加）をコミットする
- **なぜ:** 現在 `.gitignore` の変更が未コミット状態（`git status` で ` M .gitignore` を確認済み）。誰かが `git add .` や `git add -A` を実行した場合、機密ファイルが git に追跡対象として追加されてしまうリスクがある
- **実装:**
  ```bash
  cd /Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss
  git add .gitignore
  git commit -m "chore: update .gitignore to exclude local secret files"
  ```
- **運用影響:** なし（.gitignore の変更のみ。動作には影響しない）
- **所要時間:** 1分

---

### 1-2. setup-secrets.sh の API Key 平文出力をマスクする

- **何を:** `setup-secrets.sh` の 103 行目 `echo "  API Key:     $API_KEY"` を、末尾のみ表示するマスク形式に変更する
- **なぜ:** スクリプト実行時に生成した API Key が ターミナルのスクロールバック履歴・tmux ログ・iTerm2 の「Recent Sessions」などに平文で残る。特に画面共有や録画中に実行した場合のリスクがある
- **実装:**
  ```bash
  # setup-secrets.sh の 103 行目を編集
  # 変更前:
  echo "  API Key:     $API_KEY"
  # 変更後:
  MASKED_KEY="${API_KEY:0:6}****${API_KEY: -4}"
  echo "  API Key:     $MASKED_KEY"
  echo "  ↑ フルキーは .mcp.json または .x-harness-credentials.local を確認してください"
  ```
- **運用影響:** なし（表示がマスクされるだけ。実際の .mcp.json には完全な値が保存される）
- **所要時間:** 5分

---

### 1-3. file-history の現在の蓄積分を削除する

- **何を:** `~/.claude/file-history/` 内の既存 35セッション/885ファイル/8.3MB を削除する
- **なぜ:** 過去セッションで Claude Code が読み込んだファイルの内容（.env、認証情報ファイル等が含まれる可能性）が平文で保存されている。この情報はローカルディスクに残り続け、漏洩リスクとなる
- **実装:**（不可逆操作のため、まっさんに実行を依頼すること）
  ```bash
  # 削除前に内容を確認する（任意）
  ls ~/.claude/file-history/ | wc -l

  # 全セッションを削除
  rm -rf ~/.claude/file-history/*
  ```
- **運用影響:** 過去の file-history が消えるが、現在の Claude Code の動作には影響しない。Claude Code は起動時に file-history を使って変更前のファイル内容を保持するが、削除後に起動すれば新規セッション分から再蓄積される
- **所要時間:** 1分（確認含めて5分）
- **注意:** `rm -rf` は不可逆操作。実行前に `ls ~/.claude/file-history/` で対象を確認すること

---

## Phase 2: 要確認（オーナー判断必要）

### 2-1. settings.json に deny ルールを追加する

- **何を:** `~/.claude/settings.json` に `permissions.deny` セクションを追加し、.env ファイルや機密ファイルへの読み取りと、危険なコマンドの実行を禁止する
- **なぜ:** 現在 Claude Code は任意のファイルを読み書きできる状態。Claude Code が .env や認証情報ファイルを読んだ場合、その内容が `file-history` に平文で保存される。CLAUDE.md のルールは「Claude への指示」だが、`permissions.deny` は「システムレベルでの強制」であり、より確実
- **実装:**
  ```json
  // ~/.claude/settings.json に追記する内容
  {
    "permissions": {
      "deny": [
        "Read(**/.env)",
        "Read(**/.env.local)",
        "Read(**/.env.production)",
        "Read(**/.env.staging)",
        "Read(**/.x-harness-credentials.local)",
        "Read(**/.dev.vars)",
        "Bash(rm -rf *)",
        "Bash(git push --force*)",
        "Bash(git reset --hard*)"
      ]
    }
  }
  ```
  ※ 既存の settings.json の構造に追記する形で適用する
- **運用影響:**
  - .env ファイルを Claude Code に読ませるタスクができなくなる（例：「.env の内容を確認して」という指示はブロックされる）
  - `wrangler deploy` 等のコマンドは **Bash ツールで実行** されるが、wrangler 自体は .env を直接読む（Claude Code 経由ではない）ため影響なし
  - `rm -rf`、`git push --force` が Claude Code から実行できなくなる（CLAUDE.md ルールと二重の保護）
  - **追加注意:** `setup-secrets.sh` が `../.env` を読む処理は、Claude Code が Bash で実行した場合もブロックされない（Bash コマンドとして実行されるため、Read ルールは Bash 内の読み込みには適用されないケースがある）
- **選択肢:**
  1. **推奨（バランス型）:** 上記の deny リストを適用。日常タスクへの影響を最小化しながら主要リスクをカバーする
  2. **強化型:** さらに `Write(**/.env*)`、`Bash(curl * | bash*)` 等も追加。Claude Code の自由度は下がるが保護は強まる
  3. **現状維持（対応しない）:** CLAUDE.md のルールで運用を続ける。設定変更の手間はなし。ただし技術的な強制力はない状態が続く

---

### 2-2. skipDangerousModePermissionPrompt の設定を見直す

- **何を:** `settings.json` の `skipDangerousModePermissionPrompt: true` を `false` に変更するか、意図的な設定であることをコメントや記録に残す
- **なぜ:** この設定が `true` の場合、Claude Code が危険なモード（たとえばすべてのファイルへの書き込みを許可するなど）を要求したときに確認プロンプトが表示されずにスキップされる。意図的に設定している場合は問題ないが、デフォルトのままの可能性がある場合はリスクになる
- **実装:**
  ```json
  // false に変更する場合
  "skipDangerousModePermissionPrompt": false

  // 現状維持（意図的な設定）の場合はコメントを記録として残す（settings.json はコメント不可のため、MEMORY.md等に記録）
  ```
- **運用影響:**
  - `false` に変更した場合: Claude Code で作業中に「このモードで続行しますか？」という確認ダイアログが表示される頻度が増える可能性がある（具体的な頻度はワークフローによる）
  - `true` のまま維持: 現状通り。確認ダイアログなしでスムーズに作業できるが、誤操作時のガードが弱い
- **選択肢:**
  1. **false に変更:** 安全性優先。確認ダイアログが増えるが、誤操作を防げる
  2. **true のまま維持（明示的に記録）:** 利便性優先。MEMORY.md に「意図的な設定」として記録を残す
  3. **プロジェクト別に設定:** x-harness-oss 等の特定プロジェクトのみ false に設定し、日常作業プロジェクトは true のまま

---

## Phase 3: 継続的改善

### 3-1. file-history の月次削除を運用ルール化する

- **何を:** 毎月1回、`~/.claude/file-history/` 内の古いセッションを削除するルーティンを MEMORY.md に追記する
- **なぜ:** file-history は削除の仕組みがなく無限に蓄積する。過去の機密ファイル読み込み履歴が長期間残り続けることを防ぐ
- **実装:**
  ```bash
  # 月次削除コマンド（手動実行）
  # 30日以上前のセッションを削除する場合:
  find ~/.claude/file-history -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +

  # または全削除（毎月1日に実行）:
  rm -rf ~/.claude/file-history/*
  ```
  MEMORY.md に以下を追記:
  ```
  ## 月次メンテナンス（毎月1日）
  - [ ] ~/.claude/file-history/ を削除（rm -rf ~/.claude/file-history/*）
  ```
- **運用影響:** 過去のセッションの file-history が消えるが Claude Code の動作には影響しない
- **所要時間:** 設定 10分 / 以降は月1回の作業（1分）

---

### 3-2. プロジェクト別 settings.json で deny ルールを細分化する

- **何を:** x-harness-oss プロジェクト専用の設定ファイルを作成し、そのプロジェクト固有の機密ファイルへのアクセスを禁止する
- **なぜ:** グローバルの settings.json に全プロジェクトの deny ルールを書くと管理が複雑になる。プロジェクト別に設定することで、必要に応じてプロジェクト単位でルールを調整できる
- **実装:**
  ```bash
  # x-harness-oss プロジェクト設定（存在しない場合は新規作成）
  # Claude Code のプロジェクト設定は .claude/settings.json に配置

  # x-harness-oss/.claude/settings.json を作成:
  mkdir -p /Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss/.claude
  ```
  ```json
  {
    "permissions": {
      "deny": [
        "Read(.x-harness-credentials.local)",
        "Read(.mcp.json)",
        "Read(apps/worker/wrangler.toml)"
      ]
    }
  }
  ```
  **注意:** `.claude/` ディレクトリと `settings.json` は `.gitignore` に追加すること（機密ルールの漏洩を防ぐため）
- **運用影響:** wrangler.toml の account_id 等を Claude Code に「確認して」と指示できなくなる。ただし意図しない機密情報の読み込みを防げる
- **所要時間:** 10分

---

### 3-3. CLAUDE.md にテストファーストフローを追記する

- **何を:** CLAUDE.md の安全ルールに「実装前にテストコードを作成・確認する」というフローを明文化する
- **なぜ:** 運用指針チェックリスト項目5「実装前にテストコードを作成させ、品質と安全性を検証するフローを遵守しているか」が CLAUDE.md に明文化されていない。明文化することで Claude Code セッション開始時に自動的にルールが読み込まれる
- **実装:**
  ```markdown
  ## 開発フロー（必須）
  - 新機能の実装前にテストコードのスケルトンを作成する
  - 実装後にテストを実行し、全件パスを確認してからコミットする
  ```
  を CLAUDE.md の「基本姿勢」セクションに追記する
- **運用影響:** Claude Code に指示する際、テストファーストを促すルールが自動適用される。作業時間がやや増えるが、品質が向上する
- **所要時間:** 5分

---

### 3-4. wrangler.toml のローカル差分を管理ルール化する

- **何を:** x-harness-oss の `apps/worker/wrangler.toml` に `account_id` や `database_id` を書いた場合にコミットしないよう、git の差分管理ルールを設ける
- **なぜ:** ローカルの wrangler.toml に実際の account_id / database_id が記載されており（現在はコミットされていないが）、`git add .` を誤って実行した場合に混入するリスクがある
- **実装（2つの選択肢）:**
  ```bash
  # 選択肢A: git assume-unchanged で差分を無視する
  git -C /Users/kedit/Desktop/dev/x-auto-poster/x-harness-oss \
    update-index --assume-unchanged apps/worker/wrangler.toml

  # 選択肢B: wrangler.local.toml に分離し、本ファイルはプレースホルダーのまま保つ
  # wrangler.local.toml に実際の account_id / database_id を書いて .gitignore に追加
  ```
- **運用影響:** 選択肢Aの場合、`git status` に wrangler.toml の変更が表示されなくなる（意図しない変更も気づきにくくなる）。選択肢Bの方が明示的で安全
- **所要時間:** 15分

---

## 優先対応サマリー

| 優先度 | タスク | 判断者 | 所要時間 |
|---|---|---|---|
| 🔴 即時 | 1-1: .gitignore コミット | まっさん実行可 | 1分 |
| 🔴 即時 | 1-3: file-history 削除 | まっさん確認後実行 | 5分 |
| 🟡 今週中 | 2-1: deny ルール追加 | まっさん判断必要 | 10分 |
| 🟡 今週中 | 1-2: setup-secrets.sh マスク | まっさん実行可 | 5分 |
| 🟠 今月中 | 2-2: skipDangerousModePermissionPrompt 見直し | まっさん判断必要 | 5分 |
| 🟢 継続 | 3-1: file-history 月次削除ルール化 | まっさん実行可 | 10分 |
| 🟢 継続 | 3-2: プロジェクト別 settings.json | まっさん実行可 | 10分 |
| 🟢 継続 | 3-3: CLAUDE.md テストフロー追記 | まっさん実行可 | 5分 |
| 🟢 継続 | 3-4: wrangler.toml 差分管理 | まっさん実行可 | 15分 |

---

*本計画は監査レポートの事実に基づき作成。推測は含まない。*
*APIキー・シークレット・パスワードの値は一切記載していない。*
