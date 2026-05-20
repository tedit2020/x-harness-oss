// =============================================================================
// kuroko-sisters-bridge: 型定義
// =============================================================================
// Slack Events API payload + Worker Bindings 型を集約。
// 一次情報: docs.slack.dev/apis/events-api/
// RESEARCH: docs/RESEARCH_PHASE3_R1_CFWORKER_SLACK_EVENTS_20260516.md §1
// =============================================================================

/**
 * Worker Bindings (wrangler.toml vars + secrets)
 *
 * vars (公開): WORKER_URL / GITHUB_OWNER / GITHUB_REPO / GITHUB_BRANCH /
 *              NTFY_BASE_URL / BOT_USER_ID (5/21 夜以降設定)
 * secrets (機密): SLACK_SIGNING_SECRET / SLACK_BOT_TOKEN / GITHUB_PAT /
 *                 NTFY_TOPIC_KEDIT / NTFY_TOPIC_BIKA / NTFY_TOPIC_AKAKO? /
 *                 NTFY_TOPIC_BROADCAST?
 */
export type Bindings = {
  // ─── vars (public) ───
  WORKER_URL: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  NTFY_BASE_URL: string;
  /** 5/21 夜 install 後に wrangler.toml [vars] に追記 + 再 deploy で有効化 (M-5) */
  BOT_USER_ID?: string;

  // ─── secrets (機密、wrangler secret put 経由のみ) ───
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  GITHUB_PAT: string;
  NTFY_TOPIC_KEDIT: string;
  NTFY_TOPIC_BIKA: string;
  /** 5/22 配布時に追加 (オプション、未設定なら fanout skip) */
  NTFY_TOPIC_AKAKO?: string;
  /** オプション、未設定なら fanout skip */
  NTFY_TOPIC_BROADCAST?: string;
};

/**
 * Slack Events API: url_verification challenge
 * 初回 Request URL 登録時に Slack から POST される (1 回限り)
 */
export type UrlVerificationPayload = {
  type: 'url_verification';
  token: string;
  challenge: string;
};

/**
 * Slack Events API: event_callback (message / reaction / app_mention 等)
 * RESEARCH §1.3-1.4 参照
 */
export type EventCallbackPayload = {
  type: 'event_callback';
  token: string;
  team_id: string;
  api_app_id: string;
  event_id: string;
  event_time: number;
  event: SlackEvent;
  authorizations?: Array<{
    enterprise_id: string | null;
    team_id: string;
    user_id: string;
    is_bot: boolean;
  }>;
};

/**
 * Slack message event (subscribe: message.channels / message.groups 等)
 * bot_id 付きは無限ループ防止のため drop。
 */
export type SlackEvent = {
  type: string;                 // 'message' / 'reaction_added' / 'app_mention' 等
  channel?: string;             // C... (channel ID)
  user?: string;                // U... (user ID)
  text?: string;                // メッセージ本文 (Markdown 記法のまま)
  ts?: string;                  // メッセージ timestamp (rowid 相当)
  thread_ts?: string;           // スレッド親 ts
  channel_type?: 'channel' | 'group' | 'im' | 'mpim';
  bot_id?: string;              // bot 投稿時に付与 (無限ループ防止用)
  subtype?: string;             // 'message_changed' / 'message_deleted' 等
};

export type SlackEventPayload = UrlVerificationPayload | EventCallbackPayload;

/**
 * GitHub Contents API GET response (kuroko-org log push 用)
 * 既存 file 取得 → SHA + base64 content
 */
export type GitHubContentsGetResponse = {
  sha: string;
  content: string;   // base64 encoded
  encoding: 'base64';
  type: 'file';
};

// Phase 3 v4 A-v3-4: DialogEventPayload 型追加（I-4 High 解消）
// /slack/dialog endpoint 専用。pushNtfyDialog() の引数型として使用。
// 既存 EventCallbackPayload / SlackEvent / Bindings は変更なし（別 type として定義）。
// 詳細: docs/PLAN_PHASE3_V3_AKAKO_INFRA_BRIDGE_v4_20260520.md §2.2.2
/**
 * /slack/dialog endpoint 専用の Slack event payload 型。
 * Worker が受信する event_callback の event フィールドを絞り込んだ型。
 * pushNtfyDialog() の引数に使用し、type-safe な JSON fanout を保証する。
 */
export type DialogEventPayload = {
  type: 'message';
  text: string;
  ts: string;
  thread_ts?: string;
  channel: string;
  user: string;
};
