import { callJson, isObj } from "./ai";
import { db, getSettings, type ProjectRow } from "./db";
import { getProject, logEvent, type Lp } from "./loop";
import { EXTRAS_RULE, takeExtras } from "./voices";
import { AUTO_PLATFORMS, blueskySession, threadsPost, threadsToken } from "./snsApi";
import { external } from "./untrusted";

// 自分の投稿（Threads・Bluesky）についたコメントを取り込み、AIが返信の案を書く。返信するのは、人が「送る」を押したときだけ
// X はコメントを読むのに費用がかかるので、今は取り込まない

export type CommentRow = {
  id: number; post_id: number; project_id: number; platform: string; ext_id: string; ext_cid: string | null; root_uri: string | null; root_cid: string | null;
  author: string; text: string; commented_at: string | null; draft: string | null; draft_reason: string | null;
  status: "new" | "replied" | "ignored"; reply_url: string | null; replied_at: string | null; fetched_at: string;
};

type Post = { id: number; project_id: number; platform: string; post_url: string };

// 直近14日の自分の投稿だけを見る
function recentPosts(platform: string): Post[] {
  return db().prepare("SELECT id, project_id, platform, post_url FROM sns_posts WHERE platform = ? AND status = 'posted' AND post_url IS NOT NULL AND posted_at >= datetime('now', '-14 days')").all(platform) as Post[];
}

const insert = () => db().prepare(
  `INSERT OR IGNORE INTO sns_comments (post_id, project_id, platform, ext_id, ext_cid, root_uri, root_cid, author, text, commented_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

async function fetchThreads(): Promise<number> {
  const posts = recentPosts("threads");
  if (!posts.length || !AUTO_PLATFORMS.threads.configured()) return 0;
  const token = encodeURIComponent(threadsToken());
  // 投稿のURLの最後の部分から、Threads の投稿のIDを引く
  const mine = (await (await fetch(`https://graph.threads.net/v1.0/me/threads?fields=id,permalink,username&limit=50&access_token=${token}`)).json()) as { data?: { id: string; permalink: string; username: string }[] };
  const byCode = new Map((mine.data ?? []).map((m) => [m.permalink.split("/post/")[1]?.replace(/\/$/, ""), m]));
  let n = 0;
  for (const p of posts) {
    const m = byCode.get(p.post_url.split("/post/")[1]?.replace(/\/$/, ""));
    if (!m) continue;
    const res = await fetch(`https://graph.threads.net/v1.0/${m.id}/replies?fields=id,text,username,timestamp&access_token=${token}`);
    const data = (await res.json().catch(() => ({}))) as { data?: { id: string; text?: string; username: string; timestamp: string }[] };
    for (const c of data.data ?? []) {
      if (c.username === m.username || !c.text) continue; // 自分の返信は数えない
      n += insert().run(p.id, p.project_id, "threads", c.id, null, null, null, `@${c.username}`, c.text.slice(0, 1000), c.timestamp).changes;
    }
  }
  return n;
}

type BskyPost = { uri: string; cid: string; author: { did: string; handle: string }; record: { text?: string; createdAt?: string } };
type BskyThread = { post: BskyPost; replies?: { post?: BskyPost }[] };

async function fetchBluesky(): Promise<number> {
  const posts = recentPosts("bluesky");
  if (!posts.length || !AUTO_PLATFORMS.bluesky.configured()) return 0;
  let n = 0;
  for (const p of posts) {
    // https://bsky.app/profile/{did}/post/{rkey} → at://{did}/app.bsky.feed.post/{rkey}
    const m = p.post_url.match(/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (!m) continue;
    const uri = `at://${m[1]}/app.bsky.feed.post/${m[2]}`;
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=1`);
    const data = (await res.json().catch(() => ({}))) as { thread?: BskyThread };
    const root = data.thread?.post;
    if (!root) continue;
    for (const r of data.thread?.replies ?? []) {
      const c = r.post;
      if (!c?.record?.text || c.author.did === root.author.did) continue; // 自分の返信は数えない
      n += insert().run(p.id, p.project_id, "bluesky", c.uri, c.cid, root.uri, root.cid, `@${c.author.handle}`, c.record.text.slice(0, 1000), c.record.createdAt ?? null).changes;
    }
  }
  return n;
}

// 返信の案を書く（まだ案がない新しいコメントだけ）
async function draftReplies() {
  const rows = db().prepare("SELECT * FROM sns_comments WHERE status = 'new' AND draft IS NULL AND draft_reason IS NULL ORDER BY id LIMIT 20").all() as CommentRow[];
  if (!rows.length) return;
  const byProject = new Map<number, CommentRow[]>();
  for (const r of rows) byProject.set(r.project_id, [...(byProject.get(r.project_id) ?? []), r]);
  for (const [pid, list] of byProject) {
    const p = getProject(pid) as ProjectRow;
    const lp = p.lp ? (JSON.parse(p.lp) as Lp) : null;
    const post = (id: number) => (db().prepare("SELECT text FROM sns_posts WHERE id = ?").get(id) as { text: string }).text;
    const out = await callJson<{ replies: { id: number; reply: string; reason: string }[] }>({
      purpose: "コメントへの返信の案",
      projectId: pid,
      system: `あなたは、個人が作った小さな${p.kind === "tool" ? "Webツール" : "サービス"}の運営者として、自分のSNSの投稿についたコメントへの返信の案を書きます。返信を送るかどうかは、運営者が決めます。
守ること:
- 短く、丁寧で、相手の言葉を受け止める（日本語で100文字以内）
- 質問には、ページに書かれていることの範囲で答える。分からないことは分からないと書く。できないことを、できるかのように書かない
- 運営者の体験談を作らない。架空の数字・実績を書かない
- リンクや宣伝を繰り返さない（相手が使い方を聞いているときだけ、短く案内する）
- 宣伝・荒らし・攻撃的なコメント・意味の取れないコメントには返信しない。そのときは reply を空にして、reason に理由を書く
形式: {"replies":[{"id":コメントの番号,"reply":"返信の案（返さないなら空）","reason":"返さない理由（返すなら空）"}]}
${EXTRAS_RULE}`,
      user: `サービス: ${p.title}\n中身: ${p.solution}\nページの見出し: ${lp?.headline ?? ""}\nページに書かれている特徴: ${lp?.features.map((f) => f.title).join(" / ") ?? ""}\n\nコメント:\n${external(list.map((c) => `【${c.id}】${AUTO_PLATFORMS[c.platform as "threads"].label}の投稿「${post(c.post_id).slice(0, 120)}」への ${c.author} のコメント: ${c.text}`).join("\n"))}`,
      validate: (v): v is { replies: { id: number; reply: string; reason: string }[] } => isObj(v) && Array.isArray(v.replies),
    });
    takeExtras(out, { modelId: getSettings().loopModel, scene: "コメントへの返信の案", projectId: pid });
    const upd = db().prepare("UPDATE sns_comments SET draft = ?, draft_reason = ? WHERE id = ?");
    for (const r of out.replies) {
      if (!list.some((c) => c.id === Number(r.id))) continue;
      const reply = typeof r.reply === "string" ? r.reply.trim().slice(0, 280) : "";
      upd.run(reply || null, reply ? null : (typeof r.reason === "string" && r.reason.trim() ? r.reason.slice(0, 200) : "返信しなくてよいコメントです"), Number(r.id));
    }
  }
}

// 5分ごとの取り込みから呼ぶ
export async function syncComments(): Promise<number> {
  if (getSettings().killSwitch) return 0;
  const n = (await fetchThreads().catch(() => 0)) + (await fetchBluesky().catch(() => 0));
  if (n) logEvent(null, "system", "sns-comments", `SNSの投稿に新しいコメントが${n}件つきました`);
  await draftReplies();
  return n;
}

export function listComments(): (CommentRow & { title: string; post_text: string; post_url: string | null })[] {
  return db().prepare(
    `SELECT c.*, p.title, s.text AS post_text, s.post_url FROM sns_comments c JOIN projects p ON p.id = c.project_id JOIN sns_posts s ON s.id = c.post_id
     ORDER BY CASE c.status WHEN 'new' THEN 0 ELSE 1 END, c.id DESC LIMIT 100`,
  ).all() as (CommentRow & { title: string; post_text: string; post_url: string | null })[];
}

export function newCommentCount(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM sns_comments WHERE status = 'new'").get() as { n: number }).n;
}

// 人が「送る」を押したときだけ返信する
export async function sendReply(id: number, text: string): Promise<string> {
  const c = db().prepare("SELECT * FROM sns_comments WHERE id = ?").get(id) as CommentRow | undefined;
  if (!c || c.status !== "new") throw new Error("返信できるコメントが見つかりません");
  const body = text.trim();
  if (!body) throw new Error("返信の文を書いてください");
  let url: string;
  if (c.platform === "threads") {
    if (body.length > 500) throw new Error("Threads の返信は500文字までです");
    url = (await threadsPost({ text: body, reply_to_id: c.ext_id })).url;
  } else {
    if ([...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(body)].length > 300) throw new Error("Bluesky の返信は300文字までです");
    const s = await blueskySession();
    const res = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.accessJwt}` },
      body: JSON.stringify({
        repo: s.did, collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post", text: body, createdAt: new Date().toISOString(), langs: ["ja"],
          reply: { root: { uri: c.root_uri, cid: c.root_cid }, parent: { uri: c.ext_id, cid: c.ext_cid } },
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { uri?: string; message?: string };
    if (!res.ok || !data.uri) throw new Error(`Bluesky への返信に失敗（${res.status}）: ${data.message ?? ""}`.slice(0, 200));
    url = `https://bsky.app/profile/${s.did}/post/${data.uri.split("/").pop()}`;
  }
  db().prepare("UPDATE sns_comments SET status = 'replied', draft = ?, reply_url = ?, replied_at = datetime('now') WHERE id = ?").run(body, url || null, id);
  logEvent(c.project_id, "human", "sns-reply", `${c.author} のコメントに返信: ${body.slice(0, 60)}`);
  return url;
}

export function ignoreComment(id: number) {
  db().prepare("UPDATE sns_comments SET status = 'ignored' WHERE id = ? AND status = 'new'").run(id);
}
