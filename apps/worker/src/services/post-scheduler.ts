import { XClient, XApiRateLimitError } from '@x-harness/x-sdk';
import { getDueScheduledPosts, updateScheduledPostStatus } from '@x-harness/db';

export async function processScheduledPosts(db: D1Database, xClient: XClient, xAccountId?: string): Promise<void> {
  const allDuePosts = await getDueScheduledPosts(db);
  const duePosts = xAccountId ? allDuePosts.filter((p) => p.x_account_id === xAccountId) : allDuePosts;

  for (const post of duePosts) {
    try {
      const tweet = await xClient.createTweet({
        text: post.text,
        media: post.media_ids ? { media_ids: JSON.parse(post.media_ids) } : undefined,
      });
      await updateScheduledPostStatus(db, post.id, 'posted', tweet.id);
    } catch (err) {
      if (err instanceof XApiRateLimitError) {
        // Transient rate limit — leave post as 'scheduled' so the next cron run retries
        console.error(`Rate limited while posting scheduled ${post.id}, will retry next run`);
        return;
      }
      const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`Failed to post scheduled ${post.id}:`, errMsg);
      await updateScheduledPostStatus(db, post.id, 'failed');
      // Save error detail to DB for diagnosis
      await db.prepare("INSERT INTO api_usage_logs (id, x_account_id, endpoint, request_count, date, created_at) VALUES (?, ?, ?, ?, date('now'), datetime('now'))").bind(crypto.randomUUID(), post.x_account_id, `post_error:${errMsg.slice(0, 200)}`, 0, ).run().catch(() => {});
    }
  }
}
