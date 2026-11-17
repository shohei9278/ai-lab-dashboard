import { callClaude, callJson, isObj, isStr, type ClaudeContent } from "./ai";
import { hasKey } from "./models";
import { db, getSettings, saveSettings } from "./db";
import { jstToday, logEvent } from "./loop";
import { X_READ_COST_USD, searchEach, searchSince, xConfigured } from "./xPost";
import { WANT_QUERIES, searchWants } from "./userWants";
import { external } from "./untrusted";

// 話題の個人開発の投稿
// あなたが貼ったURLと、アイデアを出す日の X の検索で拾った「伸びた投稿」を、AIが読んで「なぜ伸びたか」をまとめる。
// 本文・数字・画像は公開されている情報（fxtwitter の無料の API）から取り、画像はAIに見せるだけで保存しない。
// まとめは、SNSの投稿の書き方・LPの見せ方・アイデア出し（切り口だけ。題材はまねさせない）に渡す

// type: launch = 作った人の紹介 / share = 使った人が結果をシェアした投稿（診断・ジェネレーターなどのツールで伸びる形）
// aim: どのねらいの参考になるか（役に立つ・広がる・また来てもらう・稼ぐ）
export const VIRAL_AIMS = { useful: "役に立つ", spread: "広がる", return: "また来てもらう", earn: "稼ぐ" } as const;
export type ViralAim = keyof typeof VIRAL_AIMS;
export type ViralAnalysis = { type?: "launch" | "share"; aim?: ViralAim; app?: string; genre: string; format: string; hook: string; visual: string; why: string; takeaway: string; angle: string };
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

type SearchResult = { read: number; added: number; wants: number; wantsError?: string };
const g = globalThis as unknown as { __aiLabViralQueue?: boolean; __aiLabViralSearch?: Promise<SearchResult> };

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
    system: `あなたはSNSマーケティングとプロダクトの編集者です。Xでよく伸びた、個人が作ったもの（アプリ・Webサービス・ツールのほか、ブラウザゲーム・診断・ネタ・おもちゃなど、遊べる・使えるもの）に関する投稿を読み、ほかの作品の投稿やLP・ツールの作りに活かせる形で「なぜ伸びたか」をまとめます。
役に立つものだけでなく、遊び・ネタとして伸びたものも同じように参考にする。
投稿は次のどちらかです。
- launch: 作った人が、自分の作ったものを紹介した投稿
- share: 使った人・遊んだ人が、診断・ジェネレーター・計算ツール・ゲームなどの結果をシェアした投稿（自動で作られたシェア文やOGP画像を含む）。シェアされる仕組みとして参考にする
- type: launch / share
- aim: 何の参考になるか。useful（役に立つ。使われる道具として伸びた）/ spread（広がる。遊び・ネタ・結果の見せ合いで伸びた）/ return（また来てもらう。毎日・日替わり・続けて遊ぶ仕組み）/ earn（稼ぐ。収益化の話）のどれか1つ
- app: どんなアプリ・ツールで、何ができるのか（1文。投稿から読み取れる範囲で）
- genre: 題材の分野（例: 旅行・暮らし / 家計 / 勉強 / 仕事効率化 / ゲーム・遊び / あるある・ネタ）
- format: 作ったものの形（例: スマホアプリ / Webサービス / ブラウザゲーム / 診断 / ブラウザ拡張 / デジタル商品）
- hook: 本文の言葉の型。具体的な題材を抜いた形で書く（例: 「もっと〇〇したくなる〇〇」と使ったあとの気持ちで言い切る、説明なしの一言）
- visual: 画像・動画の見せ方（例: 実際の画面を4枚、使う場面が一目で分かる / 余白が多い淡い配色）
- why: 伸びた理由を1〜2文（反応の数字の特徴も踏まえる。ブックマークがいいねの2割を超えるなら「あとで使いたい」が強い、など）
- takeaway: 別のプロダクトの投稿やLPに活かせることを1文
- angle: アイデアの切り口を1文。題材は抽象化し、このアプリと同じものを作る方向にしない（例: 機能より「〇〇したくなる気持ち」を売る）
share のときは、hook に「シェア文の型」、visual に「シェアされる結果の見せ方（OGP画像など）」、takeaway に「ツールの結果をシェアされやすくする作り方」を書く。
推測で書くところは言い切らない。launch でも share でもない投稿（作ったものと関係のない話題など）なら、why に「参考にならない」と書く。
出力はJSONのみ: {"type":"launch","aim":"spread","app":"","genre":"","format":"","hook":"","visual":"","why":"","takeaway":"","angle":""}`,
    content,
    maxTokens: 4000,
  });
  const s = out.replace(/```(?:json)?/g, "");
  const v = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)) as Record<string, unknown>;
  if (!isObj(v) || !isStr(v.why)) throw new Error("まとめを読み取れませんでした");
  const a: ViralAnalysis = {
    type: v.type === "share" ? "share" : "launch",
    // 決めた値だけ（in だと constructor などの組み込みの名前も通るので、自分の項目かで見る）
    aim: typeof v.aim === "string" && Object.hasOwn(VIRAL_AIMS, v.aim) ? (v.aim as ViralAim) : undefined,
    app: String(v.app ?? "").slice(0, 200),
    genre: String(v.genre ?? ""), format: String(v.format ?? ""), hook: String(v.hook ?? ""), visual: String(v.visual ?? ""),
    why: String(v.why).slice(0, 300), takeaway: String(v.takeaway ?? "").slice(0, 200), angle: String(v.angle ?? "").slice(0, 200),
  };
  const useless = /参考にならない/.test(a.why);
  db().prepare("UPDATE viral_posts SET status = ?, error = ?, analysis = ? WHERE id = ?").run(useless ? "error" : "ok", useless ? "自分で作った、遊べる・使えるものの紹介ではありませんでした" : null, JSON.stringify(a), r.id);
}

// ---- アイデアを出す日の検索 ----

// 作った人の投稿だけだと開発者どうしの話に偏るので、使った人のシェアと、便利なものの紹介も読む
// 役に立つものだけでなく、遊び・ネタ（広がる）、毎日遊ぶもの（また来てもらう）、収益化（稼ぐ）の投稿も読む
// 伸びる投稿は「作りました」と書かないことも多いので、個人が作ったものを置く場所へのリンクでも探す
export const VIRAL_QUERIES = [
  "(個人開発 OR アプリ作った OR アプリを作りました OR リリースしました OR 作ってみた) has:media -is:retweet -is:reply lang:ja",
  "(診断 OR メーカー OR ジェネレーター OR シミュレーター) (やってみた OR 結果 OR 作れる OR できた) has:media -is:retweet -is:reply lang:ja",
  "(神ツール OR 神アプリ OR これ便利 OR 便利すぎ OR 無料で使える) (アプリ OR ツール OR サイト) -is:retweet -is:reply lang:ja",
  "(ゲーム作りました OR ゲームを作りました OR ゲーム作った OR ブラウザゲーム OR ブラウザで遊べ OR 遊べます OR #ゲーム制作 OR #個人開発ゲーム OR #gamedev) -is:retweet -is:reply lang:ja",
  "(日替わり OR 毎日更新 OR 今日のお題 OR デイリー OR 毎日遊べる OR 連続正解) (ゲーム OR クイズ OR パズル OR 診断 OR 占い) -is:retweet -is:reply lang:ja",
  "(個人開発 OR 自作アプリ OR 自作ツール OR 自作サービス) (収益 OR 売上 OR 万円 OR 課金 OR 広告収入 OR 黒字) -is:retweet -is:reply lang:ja",
  "(url:github.io OR url:vercel.app OR url:netlify.app OR url:pages.dev OR url:unityroom.com OR url:itch.io) -is:retweet -is:reply lang:ja",
];

// 1回の検索（話題の投稿と「欲しい」の声）で読む投稿の数。X の API は、読んだ投稿1件ごとに費用がかかる
export function searchReads(s: { viralPerQuery: number; wantsPerQuery: number }): number {
  return VIRAL_QUERIES.length * s.viralPerQuery + (s.wantsPerQuery > 0 ? WANT_QUERIES.length * s.wantsPerQuery : 0);
}

// 前回の検索のあとの投稿を読み、反応の大きいものを上から取り込む（いいね50以上・最大10件）
export async function searchViral(since: string): Promise<{ read: number; added: number; error?: string }> {
  const s = getSettings();
  let read = 0;
  try {
    const all: { id: string; score: number; likes: number }[] = [];
    const found = await searchEach(VIRAL_QUERIES, s.viralPerQuery, since, (n) => { read += n; });
    for (const p of found.posts) {
      const m = p.public_metrics;
      if (m) all.push({ id: p.id, likes: m.like_count, score: m.like_count + (m.bookmark_count ?? 0) * 2 + m.retweet_count * 3 });
    }
    const known = new Set((db().prepare("SELECT tweet_id FROM viral_posts").all() as { tweet_id: string }[]).map((x) => x.tweet_id));
    const picks = all.filter((x) => x.likes >= 50 && !known.has(x.id)).sort((a, b) => b.score - a.score).slice(0, 10);
    const added = queueViral(picks.map((x) => `https://x.com/i/web/status/${x.id}`), "search");
    // 途中で失敗しても、それまでに読めた分は取り込む（前回の日時は進むので、ここで捨てると二度と読まない）
    if (found.error) logEvent(null, "system", "viral-error", `Xで話題の投稿の検索が途中で失敗（読めた${read}件から${added}件を取り込みました）: ${found.error}`);
    else logEvent(null, "system", "viral-search", `Xで話題の投稿を検索: ${read}件を読み、${added}件を取り込みました`);
    return { read, added, error: found.error };
  } finally {
    // 読んだ分だけ費用がかかる（失敗しても、それまでに読んだ分は記録する）
    if (read) db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (NULL, ?, 'x-api', 0, 0, ?, NULL)").run("Xで話題の投稿を検索", read * X_READ_COST_USD);
  }
}

// 話題の投稿と「欲しい」の声を、続けて検索する（どちらも前回の検索のあとの投稿だけを読む）
// 話題の投稿の検索が途中で失敗したら、「欲しい」の声は読まない（回数の上限などで続けて失敗するため）
// 検索の一式（話題の投稿・「欲しい」の声・前回の日時の保存）は同時に1つだけ動かす。動いている間に呼ばれたら、その結果を待つ
// （2つ動くと、読む費用が二重にかかり、保存する前回の日時がずれて投稿を読み落とすため）
export function searchAll(): Promise<SearchResult> {
  if (g.__aiLabViralSearch) return g.__aiLabViralSearch;
  const run = searchAllOnce().finally(() => {
    g.__aiLabViralSearch = undefined;
  });
  g.__aiLabViralSearch = run;
  return run;
}

async function searchAllOnce(): Promise<SearchResult> {
  const since = searchSince(getSettings().lastViralSearch || undefined);
  // 次の検索は、この検索を始めた時刻のあとから読む（終わった時刻にすると、検索している間に出た投稿を二度と読まない）
  const startedAt = new Date().toISOString();
  try {
    const v = await searchViral(since);
    if (v.error) return { read: v.read, added: v.added, wants: 0, wantsError: `話題の投稿の検索が途中で失敗したため、読みませんでした（${v.error}）` };
    try {
      const w = await searchWants(since);
      return { read: v.read + w.read, added: v.added, wants: w.added, wantsError: w.error };
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      logEvent(null, "system", "wants-error", `「欲しい」の声の検索でエラー: ${msg}`);
      return { read: v.read, added: v.added, wants: 0, wantsError: msg };
    }
  } finally {
    // 失敗しても、その日はもう検索しない（同じ失敗で費用をかけ続けないため。その日も手で押せる）
    saveSettings({ lastViralSearch: startedAt });
  }
}

// 日本時間の日付（YYYY-MM-DD）
const jstDateOf = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(iso));
// 今日（日本時間）すでに検索したか（未来の日時は、読み始めにも使わない壊れた値なので「まだ」とみなす）
export function searchedToday(last: string, today = jstToday(), now = Date.now()): boolean {
  const t = Date.parse(last);
  return !!last && Number.isFinite(t) && t <= now && jstDateOf(last) === today;
}

// 取り込んだ投稿のまとめが終わるまで待つ（ほかで動いているまとめも待つ。長くても ms まで）
export async function drainQueue(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!g.__aiLabViralQueue) {
      if (!db().prepare("SELECT 1 FROM viral_posts WHERE status = 'queued' LIMIT 1").get()) return;
      // まとめ1回分（AIの呼び出し）が止まっても長く待ちすぎないよう、残りの時間で区切る（まとめは裏で続ける）
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([processQueue(), new Promise((ok) => { timer = setTimeout(ok, Math.max(0, end - Date.now())); })]);
      clearTimeout(timer);
      continue;
    }
    await new Promise((ok) => setTimeout(ok, 2000));
  }
}

// アイデアを出す前に呼ぶ: 今日（日本時間）まだ検索していなければ、話題の投稿と「欲しい」の声を検索し、まとめ終わるまで待つ
// 検索しない設定・X のキーがない・止めているときは何もしない。失敗してもアイデア出しは止めない（前に取り込んだ分で進める）
export async function searchBeforeIdeas(): Promise<void> {
  const s = getSettings();
  if (!s.viralSearch || s.killSwitch || !xConfigured() || searchedToday(s.lastViralSearch)) return;
  try {
    await searchAll();
    await drainQueue(10 * 60_000);
  } catch (e) {
    logEvent(null, "system", "viral-error", `アイデア出しの前の、Xで話題の投稿の検索でエラー（前に取り込んだ分で進めます）: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
}

// ---- AIに渡す文章 ----

// 「どんなアプリか」を分析に足す前に取り込んだ投稿に、保存してある本文から後付けする（安いモデルで、1回に20件まで。5分ごとの見回りから呼ぶ）
export async function backfillViralApps(): Promise<number> {
  const rows = db().prepare("SELECT id, text, analysis FROM viral_posts WHERE status = 'ok' AND analysis IS NOT NULL AND json_extract(analysis, '$.app') IS NULL ORDER BY id DESC LIMIT 20").all() as { id: number; text: string | null; analysis: string }[];
  if (!rows.length) return 0;
  const out = await callJson<{ apps: { id: number; app: string }[] }>({
    purpose: "話題の投稿の分析（アプリの説明の追加）",
    modelId: hasKey("anthropic") ? "claude-haiku-5-5" : undefined,
    system: `Xでよく伸びた投稿の本文と分析から、「どんなアプリ・ツールで、何ができるのか」を1文で書きます。投稿から読み取れる範囲だけを書き、分からなければ空にします。
形式: {"apps":[{"id":番号,"app":"1文（分からなければ空）"}]}`,
    user: external(rows.map((r) => { const a = JSON.parse(r.analysis) as ViralAnalysis; return `【${r.id}】ジャンル: ${a.genre} / 形: ${a.format}\n本文: ${(r.text ?? "").slice(0, 400)}`; }).join("\n\n")),
    validate: (v): v is { apps: { id: number; app: string }[] } => isObj(v) && Array.isArray(v.apps),
  });
  const upd = db().prepare("UPDATE viral_posts SET analysis = ? WHERE id = ?");
  // 答えがなかった投稿も空で埋める（次の見回りで同じ投稿を読み直さないように）
  for (const r of rows) {
    const app = out.apps.find((x) => Number(x.id) === r.id)?.app;
    upd.run(JSON.stringify({ ...(JSON.parse(r.analysis) as ViralAnalysis), app: typeof app === "string" ? app.slice(0, 200) : "" }), r.id);
  }
  return rows.length;
}

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
    return `\n\n最近Xでよく伸びた「使った人が結果をシェアした投稿」から分かる、シェアされやすい結果の作り（参考。題材や文言はまねしない）:\n${external(shares.slice(0, 4).map((a) => `- シェア文の型: ${a.hook} / 見せ方: ${a.visual} / ${a.takeaway}`).join("\n"))}`;
  }
  if (kind === "idea") {
    return `\n\n最近Xでよく伸びた、個人が作ったもの（アプリ・ツール・遊びなど。参考にする。何が受けたか・どんな気持ちに応えたか・使われる仕組みは、別の対象者や別の題材に応用してよい。ただし同じものを作らない。名前・見た目・機能の組み合わせをそのまま写さない）:\n${external(list.map((a) => `- ${a.aim ? `［${VIRAL_AIMS[a.aim]}］` : ""}${a.app ? `${a.app}（${a.genre}）` : a.genre}: 伸びた理由: ${a.why} / 切り口: ${a.angle}`).join("\n"))}`;
  }
  if (kind === "sns") {
    return `\n\n最近Xでよく伸びた個人開発の投稿の書き方（言葉の型と見せ方だけを参考にし、文をそのまま使わない）:\n${external(list.slice(0, 5).map((a) => `- 型: ${a.hook} / 伸びた理由: ${a.why}`).join("\n"))}`;
  }
  return `\n\n最近Xでよく伸びた個人開発の見せ方（参考。そのまままねしない）:\n${external(list.slice(0, 5).map((a) => `- ${a.visual}。${a.takeaway}`).join("\n"))}`;
}
