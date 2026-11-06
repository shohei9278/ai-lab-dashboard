import { db, getSettings } from "./db";
import { logEvent } from "./loop";
import { threadsToken } from "./snsApi";
import { X_READ_COST_USD, tweetMetrics, xConfigured } from "./xPost";

// AIの投稿（宣伝・普通の投稿）についた反応（いいね・返信・リポスト）を取り込む。毎日の計画で「どの手が効いたか」を見るため
// - 投稿の翌日（20時間後）と、3日後（70時間後）の2回。10日より前の投稿は読まない
// - Bluesky は無料の公開API。Threads は分析（insights）の権限があれば無料。X は1件読むごとに費用がかかるので、翌日の1回だけ

type Target = { table: "sns_posts" | "plan_tasks"; id: number; platform: string; url: string; at: string; reactions_at: string | null };
type Reaction = { likes: number; replies: number; reposts: number };

const g = globalThis as unknown as { __aiLabReactionsAt?: number; __aiLabThreadsInsightsOff?: number };

function due(platform: string): Target[] {
  // 1回目: 20時間たって、まだ読んでいない。2回目: 70時間たって、前に読んだのが70時間より前（X は1回目だけ）
  const when = (at: string) => `${at} IS NOT NULL AND julianday('now') - julianday(${at}) <= 10 AND (
    (reactions_at IS NULL AND julianday('now') >= julianday(${at}) + 20.0 / 24)
    ${platform === "x" ? "" : `OR (julianday(reactions_at) < julianday(${at}) + 70.0 / 24 AND julianday('now') >= julianday(${at}) + 70.0 / 24)`})`;
  const a = db().prepare(`SELECT id, platform, post_url AS url, posted_at AS at, reactions_at FROM sns_posts
    WHERE platform = ? AND status = 'posted' AND author = 'ai' AND post_url IS NOT NULL AND ${when("posted_at")}`).all(platform) as Omit<Target, "table">[];
  const b = db().prepare(`SELECT id, platform, result_url AS url, done_at AS at, reactions_at FROM plan_tasks
    WHERE platform = ? AND kind = 'plain' AND status = 'done' AND result_url IS NOT NULL AND ${when("done_at")}`).all(platform) as Omit<Target, "table">[];
  return [...a.map((r) => ({ ...r, table: "sns_posts" as const })), ...b.map((r) => ({ ...r, table: "plan_tasks" as const }))];
}

function save(t: Target, r: Reaction) {
  db().prepare(`UPDATE ${t.table} SET likes = ?, replies = ?, reposts = ?, reactions_at = datetime('now') WHERE id = ?`).run(r.likes, r.replies, r.reposts, t.id);
}

async function bluesky(targets: Target[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < targets.length; i += 25) {
    const chunk = targets.slice(i, i + 25);
    const uris = chunk.map((t) => {
      const m = t.url.match(/profile\/([^/]+)\/post\/([^/?#]+)/);
      return m ? `at://${m[1]}/app.bsky.feed.post/${m[2]}` : null;
    });
    const qs = uris.filter(Boolean).map((u) => `uris=${encodeURIComponent(u!)}`).join("&");
    if (!qs) continue;
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${qs}`);
    const data = (await res.json().catch(() => ({}))) as { posts?: { uri: string; likeCount?: number; replyCount?: number; repostCount?: number; quoteCount?: number }[] };
    const byUri = new Map((data.posts ?? []).map((p) => [p.uri, p]));
    chunk.forEach((t, j) => {
      const p = uris[j] ? byUri.get(uris[j]!) : undefined;
      if (!p) return;
      save(t, { likes: p.likeCount ?? 0, replies: p.replyCount ?? 0, reposts: (p.repostCount ?? 0) + (p.quoteCount ?? 0) });
      n++;
    });
  }
  return n;
}

async function threads(targets: Target[]): Promise<number> {
  // 権限がないと分かったら、1日は試さない
  if (!targets.length || (g.__aiLabThreadsInsightsOff && Date.now() - g.__aiLabThreadsInsightsOff < 86_400_000)) return 0;
  const token = encodeURIComponent(threadsToken());
  // 投稿のURLの最後の部分から、Threads の投稿のIDを引く
  const mine = (await (await fetch(`https://graph.threads.net/v1.0/me/threads?fields=id,permalink&limit=100&access_token=${token}`)).json()) as { data?: { id: string; permalink: string }[] };
  const code = (u: string) => u.split("/post/")[1]?.replace(/[/?#].*$/, "");
  const byCode = new Map((mine.data ?? []).map((m) => [code(m.permalink), m.id]));
  let n = 0;
  for (const t of targets) {
    const id = byCode.get(code(t.url));
    if (!id) continue;
    const res = await fetch(`https://graph.threads.net/v1.0/${id}/insights?metric=likes,replies,reposts,quotes&access_token=${token}`);
    const data = (await res.json().catch(() => ({}))) as { data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[]; error?: { message?: string } };
    if (!res.ok) {
      g.__aiLabThreadsInsightsOff = Date.now();
      logEvent(null, "system", "reactions-error", `Threads の投稿の反応を読めません（分析の権限 threads_manage_insights が必要です）: ${(data.error?.message ?? res.status).toString().slice(0, 200)}`);
      return n;
    }
    const v = (name: string) => { const m = data.data?.find((x) => x.name === name); return m?.total_value?.value ?? m?.values?.[0]?.value ?? 0; };
    save(t, { likes: v("likes"), replies: v("replies"), reposts: v("reposts") + v("quotes") });
    n++;
  }
  return n;
}

async function x(targets: Target[]): Promise<number> {
  const ids = targets.map((t) => t.url.match(/status\/(\d+)/)?.[1]).filter((v): v is string => !!v);
  if (!ids.length) return 0;
  const m = await tweetMetrics(ids);
  db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (NULL, 'X の投稿の反応の取り込み', 'x-api', 0, 0, ?, NULL)").run(m.size * X_READ_COST_USD);
  let n = 0;
  for (const t of targets) {
    const r = m.get(t.url.match(/status\/(\d+)/)?.[1] ?? "");
    // 消えた投稿などで読めなかったものも、読んだことにする（毎回読みに行かないように）
    save(t, r ?? { likes: 0, replies: 0, reposts: 0 });
    if (r) n++;
  }
  return n;
}

// 5分ごとの見回りから呼ぶ。1時間に1回だけ動く
export async function syncReactions(): Promise<number> {
  const s = getSettings();
  if (s.killSwitch || (g.__aiLabReactionsAt && Date.now() - g.__aiLabReactionsAt < 3_600_000)) return 0;
  g.__aiLabReactionsAt = Date.now();
  let n = 0;
  const run = async (platform: string, fn: (t: Target[]) => Promise<number>) => {
    const targets = due(platform);
    if (!targets.length) return;
    try {
      n += await fn(targets);
    } catch (e) {
      logEvent(null, "system", "reactions-error", `投稿の反応の取り込みでエラー（${platform}）: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  };
  await run("bluesky", bluesky);
  if (process.env.THREADS_ACCESS_TOKEN) await run("threads", threads);
  if (xConfigured()) await run("x", x);
  return n;
}
