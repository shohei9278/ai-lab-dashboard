import { callClaude, isObj, isStr, type ClaudeContent } from "./ai";
import { db, getSettings, saveSettings } from "./db";
import { logEvent } from "./loop";
import { X_READ_COST_USD, searchRecent, xConfigured } from "./xPost";
import { searchWants } from "./userWants";

// 話題の個人開発の投稿
// あなたが貼ったURLと、週1回の X の検索で拾った「伸びた投稿」を、AIが読んで「なぜ伸びたか」をまとめる。
// 本文・数字・画像は公開されている情報（fxtwitter の無料の API）から取り、画像はAIに見せるだけで保存しない。
// まとめは、SNSの投稿の書き方・LPの見せ方・アイデア出し（切り口だけ。題材はまねさせない）に渡す

// type: launch = 作った人の紹介 / share = 使った人が結果をシェアした投稿（診断・ジェネレーターなどのツールで伸びる形）
export type ViralAnalysis = { type?: "launch" | "share"; genre: string; format: string; hook: string; visual: string; why: string; takeaway: string; angle: string };
export type ViralPost = {
  id: number; at: string; tweet_id: string; url: string; source: "manual" | "search"; status: "queued" | "ok" | "error"; error: string | null;
  author: string | null; text: string | null; posted_at: string | null;
  likes: number | null; reposts: number | null; bookmarks: number | null; views: number | null; images: number | null; analysis: string | null;
};

// x.com / twitter.com の投稿のURLから、投稿の番号を取り出す
export function tweetIdOf(url: string): string | null {
  const m = url.trim().match(/^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[^/]+|i\/web)\/status\/(\d{5,25})/);
  return m ? m[1] : null;
}

export function listViral(): (ViralPost & { a: ViralAnalysis | null })[] {
  return (db().prepare("SELECT * FROM viral_posts ORDER BY COALESCE(likes, 0) DESC, id DESC LIMIT 200").all() as ViralPost[])
    .map((r) => ({ ...r, a: r.analysis ? (JSON.parse(r.analysis) as ViralAnalysis) : null }));
}

export function queueViral(urls: string[], source: ViralPost["source"] = "manual"): number {
  let n = 0;
  for (const u of urls) {
    const id = tweetIdOf(u);
    if (!id) continue;
    n += db().prepare("INSERT OR IGNORE INTO viral_posts (tweet_id, url, source) VALUES (?, ?, ?)").run(id, `https://x.com/i/web/status/${id}`, source).changes;
  }
  if (n) void processQueue();
  return n;
}

export function deleteViral(id: number) {
  db().prepare("DELETE FROM viral_posts WHERE id = ?").run(id);
}

const g = globalThis as unknown as { __aiLabViralQueue?: boolean; __aiLabViralSearch?: boolean };

async function processQueue() {
  if (g.__aiLabViralQueue) return;
  g.__aiLabViralQueue = true;
  try {
    for (;;) {
      const r = db().prepare("SELECT * FROM viral_posts WHERE status = 'queued' ORDER BY id LIMIT 1").get() as ViralPost | undefined;
      if (!r) break;
      try {
        await analyze(r);
      } catch (e) {
        db().prepare("UPDATE viral_posts SET status = 'error', error = ? WHERE id = ?").run((e instanceof Error ? e.message : String(e)).slice(0, 300), r.id);
      }
    }
  } finally {
    g.__aiLabViralQueue = false;
  }
}

export function resumeViralQueue() {
  if (db().prepare("SELECT 1 FROM viral_posts WHERE status = 'queued' LIMIT 1").get()) void processQueue();
}

type FxTweet = {
  url?: string; text?: string; created_at?: string; author?: { screen_name?: string; name?: string };
  likes?: number; retweets?: number; bookmarks?: number; views?: number; replies?: number;
  media?: { photos?: { url: string }[]; videos?: unknown[] };
};

// 本文の中のリンク先のOGP画像（診断の結果カードなど）。画像として添付されていない投稿でも、タイムラインに出る見た目をAIに見せる
async function ogImage(text: string): Promise<string | null> {
  const link = text.match(/https?:\/\/[^\s]+/)?.[0];
  if (!link) return null;
  const res = await fetch(link, { headers: { "User-Agent": "Twitterbot/1.0" }, signal: AbortSignal.timeout(15_000), redirect: "follow" }).catch(() => null);
  if (!res?.ok) return null;
  if ((res.headers.get("content-type") ?? "").startsWith("image/")) return res.url || link;
  const html = (await res.text().catch(() => "")).slice(0, 200_000);
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  if (!og) return null;
  try {
    return new URL(og.replace(/&amp;/g, "&"), res.url || link).toString();
  } catch {
    return null;
  }
}

async function analyze(r: ViralPost) {
  const res = await fetch(`https://api.fxtwitter.com/status/${r.tweet_id}`, { headers: { "User-Agent": "ai-product-lab (viral reader)" }, signal: AbortSignal.timeout(20_000) });
  const data = (await res.json().catch(() => ({}))) as { tweet?: FxTweet; message?: string };
  const t = data.tweet;
  if (!res.ok || !t) throw new Error(`投稿を読めませんでした（${res.status}）${data.message ? `: ${data.message}` : ""}`);
  const photos = t.media?.photos ?? [];
  const author = t.author?.screen_name ? `@${t.author.screen_name}` : null;
  const url = t.url ?? r.url;
  db().prepare("UPDATE viral_posts SET url = ?, author = ?, text = ?, posted_at = ?, likes = ?, reposts = ?, bookmarks = ?, views = ?, images = ? WHERE id = ?")
    .run(url, author, (t.text ?? "").slice(0, 2000), t.created_at ? new Date(t.created_at).toISOString().slice(0, 19).replace("T", " ") : null,
      t.likes ?? null, t.retweets ?? null, t.bookmarks ?? null, t.views ?? null, photos.length, r.id);

  // 画像は小さいサイズで最大4枚、AIに見せるだけ（保存しない）
  const content: ClaudeContent = [{
    type: "text",
    text: `投稿者: ${t.author?.name ?? ""}（${author ?? ""}）\n本文: ${t.text ?? ""}\n反応: いいね ${t.likes ?? "?"}・リポスト ${t.retweets ?? "?"}・ブックマーク ${t.bookmarks ?? "?"}・表示 ${t.views ?? "?"}・返信 ${t.replies ?? "?"}\n画像 ${photos.length}枚${t.media?.videos?.length ? `・動画 ${t.media.videos.length}本` : ""}`,
  }];
  const urls = photos.slice(0, 4).map((ph) => ph.url.replace(/name=\w+/, "name=small"));
  if (!urls.length) {
    const og = await ogImage(t.text ?? "");
    if (og) {
      urls.push(og);
      content.push({ type: "text", text: "（画像の添付はなし。本文のリンク先が、タイムラインに出す画像（OGP）は次のとおり）" });
    }
  }
  for (const u of urls) {
    const img = await fetch(u, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const type = img?.headers.get("content-type") ?? "";
    if (!img?.ok || !/image\/(jpeg|png)/.test(type)) continue;
    content.push({ type: "image", source: { type: "base64", media_type: type.includes("png") ? "image/png" : "image/jpeg", data: Buffer.from(await img.arrayBuffer()).toString("base64") } });
  }
  const out = await callClaude({
    purpose: "話題の投稿の分析",
    system: `あなたはSNSマーケティングとプロダクトの編集者です。Xでよく伸びた、個人開発のプロダクトに関する投稿を読み、ほかのプロダクトの投稿やLP・ツールの作りに活かせる形で「なぜ伸びたか」をまとめます。
投稿は次のどちらかです。
- launch: 作った人が、自分のプロダクトを紹介した投稿
- share: 使った人が、診断・ジェネレーター・計算ツールなどの結果をシェアした投稿（自動で作られたシェア文やOGP画像を含む）。プロダクトがシェアされる仕組みとして参考にする
- type: launch / share
- genre: 題材の分野（例: 旅行・暮らし / 家計 / 勉強 / 仕事効率化）
- format: プロダクトの形（例: スマホアプリ / Webサービス / ブラウザ拡張 / デジタル商品）
- hook: 本文の言葉の型。具体的な題材を抜いた形で書く（例: 「もっと〇〇したくなる〇〇」と使ったあとの気持ちで言い切る、説明なしの一言）
- visual: 画像・動画の見せ方（例: 実際の画面を4枚、使う場面が一目で分かる / 余白が多い淡い配色）
- why: 伸びた理由を1〜2文（反応の数字の特徴も踏まえる。ブックマークがいいねの2割を超えるなら「あとで使いたい」が強い、など）
- takeaway: 別のプロダクトの投稿やLPに活かせることを1文
- angle: アイデアの切り口を1文。題材は抽象化し、このアプリと同じものを作る方向にしない（例: 機能より「〇〇したくなる気持ち」を売る）
share のときは、hook に「シェア文の型」、visual に「シェアされる結果の見せ方（OGP画像など）」、takeaway に「ツールの結果をシェアされやすくする作り方」を書く。
推測で書くところは言い切らない。launch でも share でもない投稿（プロダクトと関係のない話題など）なら、why に「参考にならない」と書く。
出力はJSONのみ: {"type":"launch","genre":"","format":"","hook":"","visual":"","why":"","takeaway":"","angle":""}`,
    content,
    maxTokens: 4000,
  });
  const s = out.replace(/```(?:json)?/g, "");
  const v = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)) as Record<string, unknown>;
  if (!isObj(v) || !isStr(v.why)) throw new Error("まとめを読み取れませんでした");
  const a: ViralAnalysis = {
    type: v.type === "share" ? "share" : "launch",
    genre: String(v.genre ?? ""), format: String(v.format ?? ""), hook: String(v.hook ?? ""), visual: String(v.visual ?? ""),
    why: String(v.why).slice(0, 300), takeaway: String(v.takeaway ?? "").slice(0, 200), angle: String(v.angle ?? "").slice(0, 200),
  };
  const useless = /参考にならない/.test(a.why);
  db().prepare("UPDATE viral_posts SET status = ?, error = ?, analysis = ? WHERE id = ?").run(useless ? "error" : "ok", useless ? "個人開発のプロダクト紹介ではありませんでした" : null, JSON.stringify(a), r.id);
}

// ---- 週1回の検索 ----

const QUERY = "(個人開発 OR アプリ作った OR アプリを作りました OR リリースしました OR 作ってみた) has:images -is:retweet -is:reply lang:ja";

// 直近7日の投稿を読み、反応の大きいものを上から取り込む（いいね100以上・最大10件）
export async function searchViral(): Promise<{ read: number; added: number }> {
  if (g.__aiLabViralSearch) throw new Error("いま検索しているところです");
  g.__aiLabViralSearch = true;
  const s = getSettings();
  let read = 0;
  try {
    const all: { id: string; score: number; likes: number }[] = [];
    let next: string | undefined;
    for (let page = 0; page < Math.max(1, Math.round(s.viralSearchCount / 100)); page++) {
      const r = await searchRecent(QUERY, next);
      read += r.posts.length;
      for (const p of r.posts) {
        const m = p.public_metrics;
        if (!m) continue;
        all.push({ id: p.id, likes: m.like_count, score: m.like_count + (m.bookmark_count ?? 0) * 2 + m.retweet_count * 3 });
      }
      next = r.next;
      if (!next) break;
    }
    const known = new Set((db().prepare("SELECT tweet_id FROM viral_posts").all() as { tweet_id: string }[]).map((x) => x.tweet_id));
    const picks = all.filter((x) => x.likes >= 100 && !known.has(x.id)).sort((a, b) => b.score - a.score).slice(0, 10);
    const added = queueViral(picks.map((x) => `https://x.com/i/web/status/${x.id}`), "search");
    logEvent(null, "system", "viral-search", `Xで話題の個人開発の投稿を検索: ${read}件を読み、${added}件を取り込みました`);
    return { read, added };
  } finally {
    // 読んだ分だけ費用がかかる（失敗しても、それまでに読んだ分は記録する）
    if (read) db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (NULL, ?, 'x-api', 0, 0, ?, NULL)").run("Xで話題の投稿を検索", read * X_READ_COST_USD);
    saveSettings({ lastViralSearch: new Date().toISOString() });
    g.__aiLabViralSearch = false;
  }
}

// 話題の投稿と「欲しい」の声を、続けて検索する
export async function searchAll(): Promise<{ read: number; added: number; wants: number; wantsError?: string }> {
  const v = await searchViral();
  try {
    const w = await searchWants();
    return { read: v.read + w.read, added: v.added, wants: w.added };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    logEvent(null, "system", "wants-error", `「欲しい」の声の検索でエラー: ${msg}`);
    return { read: v.read, added: v.added, wants: 0, wantsError: msg };
  }
}

// 前回から7日たっていたら検索する（スケジューラーから呼ぶ）。失敗しても次は7日後（その間は手動で押せる）
export async function maybeWeeklyViral() {
  const s = getSettings();
  if (!s.viralSearch || s.killSwitch || !xConfigured()) return;
  if (s.lastViralSearch && Date.now() - Date.parse(s.lastViralSearch) < 7 * 86_400_000) return;
  await searchAll();
}

// ---- AIに渡す文章 ----

function recentOk(limit: number): ViralAnalysis[] {
  return (db().prepare("SELECT analysis FROM viral_posts WHERE status = 'ok' AND at >= datetime('now', '-60 days') ORDER BY COALESCE(likes, 0) DESC LIMIT ?").all(limit) as { analysis: string }[])
    .map((r) => JSON.parse(r.analysis) as ViralAnalysis);
}

export function viralHints(kind: "idea" | "sns" | "page" | "tool"): string {
  const list = recentOk(8);
  if (!list.length) return "";
  if (kind === "tool") {
    const shares = list.filter((a) => a.type === "share");
    if (!shares.length) return "";
    return `\n\n最近Xでよく伸びた「使った人が結果をシェアした投稿」から分かる、シェアされやすい結果の作り（参考。題材や文言はまねしない）:\n${shares.slice(0, 4).map((a) => `- シェア文の型: ${a.hook} / 見せ方: ${a.visual} / ${a.takeaway}`).join("\n")}`;
  }
  if (kind === "idea") {
    return `\n\n最近Xでよく伸びた個人開発の投稿から読み取れる切り口（参考。題材やアプリそのものはまねしない。同じ題材・似たアプリは出さない）:\n${list.map((a) => `- ${a.angle}（${a.genre}）`).join("\n")}`;
  }
  if (kind === "sns") {
    return `\n\n最近Xでよく伸びた個人開発の投稿の書き方（言葉の型と見せ方だけを参考にし、文をそのまま使わない）:\n${list.slice(0, 5).map((a) => `- 型: ${a.hook} / 伸びた理由: ${a.why}`).join("\n")}`;
  }
  return `\n\n最近Xでよく伸びた個人開発の見せ方（参考。そのまままねしない）:\n${list.slice(0, 5).map((a) => `- ${a.visual}。${a.takeaway}`).join("\n")}`;
}
