import { viralHints } from "./viralPosts";
import { badPostsText } from "./postStats";
import crypto from "node:crypto";
import { callJson, isObj, isStr } from "./ai";
import { db, getSettings, monthSpendUsd, type ProjectRow } from "./db";
import { AUTO_PLATFORMS, autoPlatforms, postAllowed, xWeightedLength, type AutoPlatform } from "./snsApi";
import { CONV, KIND_LABEL, getProject, logEvent, type Lp } from "./loop";
import { publicUrl } from "./publish";

// SNSへの投稿。画面からXの投稿画面を開いて、あなたが投稿することもできる。
// 設定で「自動で投稿」をオンにし、X・Threads・Bluesky のキーを入れると、AIが下書きして自動で投稿する（毎日の計画、または計画がない日は maybeAutoPost）。
// 投稿ごとに専用のリンクを付けるので、どの投稿から何人来て、何人が登録・利用したかが分かる

// status の link は、以前の「集客の作戦」で場所ごとに作った専用リンク（投稿ではない）
export type SnsPost = {
  id: number; created_at: string; project_id: number; platform: string; code: string; angle: string | null; text: string;
  author: "ai" | "human"; status: "draft" | "posted" | "link"; posted_at: string | null; post_url: string | null;
  impressions: number | null; visits: number; conversions: number;
};

export { xWeightedLength };
export const X_LIMIT = 280;

export function postLink(projectId: number, code: string): string | null {
  const base = publicUrl(projectId);
  return base ? `${base}?s=${code}` : null;
}

export function listPosts(projectId: number): SnsPost[] {
  return db().prepare("SELECT * FROM sns_posts WHERE project_id = ? AND status != 'link' ORDER BY status = 'posted', id DESC").all(projectId) as SnsPost[];
}

const newCode = () => crypto.randomBytes(4).toString("hex").slice(0, 6);

export function addPost(projectId: number, text: string, author: "ai" | "human", angle: string | null = null, platform = "x"): number {
  return Number(
    db().prepare("INSERT INTO sns_posts (project_id, code, angle, text, author, platform) VALUES (?, ?, ?, ?, ?, ?)").run(projectId, newCode(), angle, text, author, platform).lastInsertRowid,
  );
}

// AIに、切り口の違う投稿の下書きをいくつか作らせる
// この案件の集客の方針を、下書きを書くAIに渡す（どの手が効いたかは、毎日の計画が切り口として指示する）
function planContext(projectId: number): string {
  // 案件ごとの方針: 集客の見直しで決めたもの（あれば最優先）と、企画のときに決めた最初の届け方
  const p = getProject(projectId);
  const own = p?.growth_focus
    ? `\n\nこの案件の今の集客の方針（最優先で従う）: ${p.growth_focus}`
    : p?.first_channel ? `\n\nこの案件の最初の届け方（企画のときに決めたもの）: ${p.first_channel}` : "";
  return own;
}

export async function draftPosts(projectId: number, count: number, hint?: string, platform: AutoPlatform = "x"): Promise<number[]> {
  const p = getProject(projectId);
  if (!p?.lp) throw new Error("まだLPやツールがありません");
  const lp = JSON.parse(p.lp) as Lp;
  const past = listPosts(projectId).filter((x) => x.status === "posted").map((x) => `- ${x.text}（訪問 ${x.visits}人・${CONV[p.kind].noun} ${x.conversions}人）`).join("\n") || "（まだなし）";
  const isTool = p.kind === "tool";
  const out = await callJson<{ posts: { angle: string; text: string }[] }>({
    purpose: "SNS投稿の下書き",
    projectId,
    system: `あなたは${AUTO_PLATFORMS[platform].label}で、個人が作った小さな${isTool ? "Webツール" : "サービス"}を紹介する投稿を書く担当です。
投稿にはリンクが自動で付くので、本文にURLは書かない。
守ること:
- 1件あたり${AUTO_PLATFORMS[platform].bodyHint}（リンクを付けても上限に収まるように）
- ${isTool ? "無料・登録不要でその場で使えることが伝わるようにする" : "まだ準備中で、事前登録を受け付けていることを正直に書く（すでに使えるとは書かない）"}
- 架空の利用者数・実績・お客様の声、効果の断言、誇大表現、他人になりすました書き方はしない
- 運営者の体験談・感想（「自分は〜にした」「〜してみたら」など）を作らない。実際にあったか分からないことは書かない。文例を紹介するときは「たとえば」「こんな一言も」のように例として示す
- ページに書かれている機能・特徴だけを書く（書かれていないことを、できるかのように書かない）
- ハッシュタグは使っても1つまで。絵文字は控えめに
- 押し付けがましい宣伝ではなく、対象の人が「自分のことだ」と思う書き出しにする
- 投稿ごとに切り口を変える（例: 困りごとへの共感 / 使い方の具体例 / 作った理由 / 問いかけ / そのまま使える文例・チェックリストを投稿の中で見せ、続きはリンク先で）
これまでの投稿と反応がある場合は、反応が良かった切り口を参考にし、同じ文は避ける。それだけで読む価値がある内容（文例・使い方の具体例など）を入れ、宣伝だけの投稿にしない。
形式: {"posts":[{"angle":"切り口を短く","text":"本文"}]}`,
    user: `${KIND_LABEL[p.kind]}: ${p.title}\n対象: ${p.target}\n困りごと・動機: ${p.problem}\n中身: ${p.solution}\nページの見出し: ${lp.headline}\nページの補足: ${lp.subheadline}\nページに書かれている特徴: ${lp.features.map((f) => `${f.title}（${f.body}）`).join(" / ")}\n件数: ${count}${hint ? `\n今回の希望: ${hint}` : ""}\n\nこれまでの投稿と反応:\n${past}${planContext(projectId)}${viralHints("sns")}${badPostsText("promo")}`,
    validate: (v): v is { posts: { angle: string; text: string }[] } =>
      isObj(v) && Array.isArray(v.posts) && v.posts.length > 0 && v.posts.every((x) => isObj(x) && isStr(x.text)),
  });
  const ids = out.posts.slice(0, count).map((x) => addPost(projectId, x.text.trim().slice(0, 500), "ai", typeof x.angle === "string" ? x.angle.slice(0, 40) : null, platform));
  logEvent(projectId, "ai", "sns-draft", `SNS投稿の下書きを${ids.length}件作成`);
  return ids;
}

function getPost(id: number): SnsPost {
  const r = db().prepare("SELECT * FROM sns_posts WHERE id = ?").get(id) as SnsPost | undefined;
  if (!r) throw new Error("投稿が見つかりません");
  return r;
}

export function updatePostText(id: number, text: string) {
  const t = text.trim().slice(0, 1000);
  if (!t) throw new Error("本文が空です");
  if (getPost(id).status === "posted") throw new Error("投稿済みの文は変えられません");
  db().prepare("UPDATE sns_posts SET text = ? WHERE id = ?").run(t, id);
}

export function markPosted(id: number, text?: string) {
  const p = getPost(id);
  if (p.status === "posted") return;
  if (text?.trim()) db().prepare("UPDATE sns_posts SET text = ? WHERE id = ?").run(text.trim().slice(0, 1000), id);
  db().prepare("UPDATE sns_posts SET status = 'posted', posted_at = datetime('now') WHERE id = ?").run(id);
  logEvent(p.project_id, "human", "sns-post", `${p.platform === "x" ? "X" : p.platform}に投稿: ${(text ?? p.text).slice(0, 60)}…`);
}

export function setPostStats(id: number, v: { postUrl?: string; impressions?: number | null }) {
  const post = getPost(id);
  if (v.postUrl !== undefined) {
    const url = v.postUrl.trim();
    const ok = post.platform === "x" ? /^https:\/\/(x|twitter)\.com\/[^\s]+$/.test(url) : /^https:\/\/[^\s]+$/.test(url);
    if (url && !ok) throw new Error(post.platform === "x" ? "X の投稿のURL（https://x.com/…）を入れてください" : "投稿のURL（https://…）を入れてください");
    db().prepare("UPDATE sns_posts SET post_url = ? WHERE id = ?").run(url || null, id);
  }
  if (v.impressions !== undefined) {
    const n = v.impressions === null ? null : Math.max(0, Math.round(Number(v.impressions)));
    db().prepare("UPDATE sns_posts SET impressions = ? WHERE id = ?").run(Number.isFinite(n) ? n : null, id);
  }
}

export function deletePost(id: number) {
  db().prepare("DELETE FROM sns_posts WHERE id = ?").run(id);
}

// 取り込んだ訪問と成果から、投稿ごとの数字を入れ直す（publish.ts の取り込みから呼ぶ）
// 訪問: そのリンクから来た人（ブラウザ単位）。成果: その人がそのあと登録・利用した数
export function attributePosts(projectId: number, views: { visitor_id: string; source?: string | null }[], conv: { visitor_id?: string | null }[]) {
  const posts = db().prepare("SELECT id, code FROM sns_posts WHERE project_id = ?").all(projectId) as { id: number; code: string }[];
  if (!posts.length) return;
  const converted = new Set(conv.map((c) => c.visitor_id).filter(Boolean));
  const upd = db().prepare("UPDATE sns_posts SET visits = ?, conversions = ? WHERE id = ?");
  for (const p of posts) {
    const visitors = new Set(views.filter((v) => v.source === p.code).map((v) => v.visitor_id));
    upd.run(visitors.size, [...visitors].filter((v) => converted.has(v)).length, p.id);
  }
}

// ---- 自動投稿 ----

// 日本時間の何時か（サーバーが海外の時刻でも、日本の昼間にだけ投稿する）
function jstHour(): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
}

// 集客中の案件を1つ選んで、AIが書いた投稿を X・Threads・Bluesky に自動で投稿する（返信・フォロー・いいねなど、他人への働きかけはしない）
// - 日本時間の8〜22時だけ。場所ごとに、直近24時間の投稿数は設定の上限まで、1つの案件は20時間に1回まで
// - まだその場所に投稿していない案件（公開したばかりの案件）を先に選ぶ
// - 投稿の費用は、AIの費用と同じ月の予算に数える
export async function maybeAutoPost(): Promise<string[]> {
  const s = getSettings();
  if (!s.autoPost || s.killSwitch) return [];
  // 今日の計画があれば、投稿の回数・時刻・切り口は計画に任せる（計画を作れなかった日だけ、決まった間隔で投稿する）
  if (s.dailyPlan && db().prepare("SELECT 1 FROM daily_plans WHERE day = ?").get(jstDay())) return [];
  const h = jstHour();
  if (h < 8 || h >= 22) return [];
  const done: string[] = [];
  for (const platform of autoPlatforms().filter((p) => postAllowed(p, "promo"))) {
    if (monthSpendUsd() * s.usdJpy >= s.monthlyBudgetJpy) break;
    try {
      const url = await autoPostTo(platform, s.autoPostPerDay);
      if (url) done.push(url);
    } catch (e) {
      logEvent(null, "system", "sns-auto-error", `${AUTO_PLATFORMS[platform].label}への自動投稿でエラー: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
    }
  }
  return done;
}

async function autoPostTo(platform: AutoPlatform, perDay: number): Promise<string | null> {
  const apiId = `${platform}-api`;
  // 失敗した直後は、2時間あけてから試す（クレジット切れなどで、5分ごとに失敗し続けないように）
  if (db().prepare("SELECT 1 FROM ai_calls WHERE model_id = ? AND error IS NOT NULL AND at >= datetime('now', '-2 hours') AND id = (SELECT MAX(id) FROM ai_calls WHERE model_id = ?)").get(apiId, apiId)) return null;
  const recent = db().prepare("SELECT COUNT(*) AS n, MAX(posted_at) AS last FROM sns_posts WHERE platform = ? AND status = 'posted' AND author = 'ai' AND post_url IS NOT NULL AND posted_at >= datetime('now', '-24 hours')").get(platform) as { n: number; last: string | null };
  if (recent.n >= perDay) return null;
  // 1日の投稿を間隔をあけて出す（例: 1日3件なら、前の投稿から5時間ほどあける）
  if (recent.last && Date.now() - Date.parse(recent.last.replace(" ", "T") + "Z") < (14 / Math.max(1, perDay)) * 3_600_000) return null;

  const candidates = db().prepare(
    `SELECT p.*, (SELECT MAX(posted_at) FROM sns_posts x WHERE x.project_id = p.id AND x.platform = ? AND x.status = 'posted') AS last_post
     FROM projects p WHERE p.stage = 'live' AND p.demo = 0 AND p.public_slug IS NOT NULL AND COALESCE(p.human_review, '') != 'bad' AND p.sns_paused = 0
     ORDER BY last_post IS NOT NULL, last_post, p.id DESC`,
  ).all(platform) as (ProjectRow & { last_post: string | null })[];
  const p = candidates.find((c) => !c.last_post || Date.now() - Date.parse(c.last_post.replace(" ", "T") + "Z") > 20 * 3_600_000);
  if (!p || !publicUrl(p.id)) return null;
  return postProject(p, platform);
}

// 公開した直後に、無料の場所（Threads・Bluesky）へ、時間帯や1日の上限を待たずに1件投稿する
// 自動投稿がオンのときだけ。失敗したら、ふだんの自動投稿の順番（まだ投稿していない案件が先）で、あとから投稿される
export async function postOnPublish(projectId: number): Promise<void> {
  const s = getSettings();
  if (!s.autoPost || s.killSwitch) return;
  const p = getProject(projectId);
  if (!p?.public_slug || !publicUrl(p.id) || p.human_review === "bad" || p.sns_paused) return;
  for (const platform of autoPlatforms()) {
    if (AUTO_PLATFORMS[platform].costUsd > 0 || !postAllowed(platform, "promo")) continue;
    if (db().prepare("SELECT 1 FROM sns_posts WHERE project_id = ? AND platform = ? AND status = 'posted'").get(p.id, platform)) continue;
    try {
      await postProject(p, platform);
    } catch (e) {
      logEvent(p.id, "system", "sns-auto-error", `${AUTO_PLATFORMS[platform].label}への公開時の投稿でエラー: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
    }
  }
}

// 毎日の計画から呼ぶ: 決めた切り口で1件書いて投稿する。投稿のURLを返す（見送ったときは null）
export async function postPromo(projectId: number, platform: AutoPlatform, hint: string): Promise<string | null> {
  const p = getProject(projectId);
  if (!p?.public_slug || !publicUrl(p.id)) throw new Error("公開中の案件ではありません");
  if (p.human_review === "bad" || p.sns_paused) throw new Error("この案件は投稿を止めています");
  return postProject(p, platform, hint);
}

// 日本時間の YYYY-MM-DD
export function jstDay(d = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
}

// 場所ごとの、直近24時間のAIの投稿の数（宣伝と普通の投稿の合計。毎日の計画の安全装置に使う）
export function aiPostsLast24h(platform: string): number {
  const a = (db().prepare("SELECT COUNT(*) AS n FROM sns_posts WHERE platform = ? AND status = 'posted' AND author = 'ai' AND posted_at >= datetime('now', '-24 hours')").get(platform) as { n: number }).n;
  const b = (db().prepare("SELECT COUNT(*) AS n FROM plan_tasks WHERE platform = ? AND kind = 'plain' AND status = 'done' AND done_at >= datetime('now', '-24 hours')").get(platform) as { n: number }).n;
  return a + b;
}

async function postProject(p: ProjectRow, platform: AutoPlatform, hint?: string): Promise<string | null> {
  const def = AUTO_PLATFORMS[platform];
  const apiId = `${platform}-api`;
  // 切り口の指定があれば新しく書かせる。なければ、まだ投稿していないAIの下書きを使い、なければ1件書かせる
  let draft = hint ? undefined : db().prepare("SELECT * FROM sns_posts WHERE project_id = ? AND status = 'draft' AND author = 'ai' AND platform = ? ORDER BY id LIMIT 1").get(p.id, platform) as SnsPost | undefined;
  if (!draft) {
    const [id] = await draftPosts(p.id, 1, hint, platform);
    draft = getPost(id);
  }
  const link = postLink(p.id, draft.code)!;
  if (!def.fits(draft.text, link)) {
    logEvent(p.id, "system", "sns-auto-skip", `下書きが長すぎるため、${def.label}への自動投稿を見送りました: ${draft.text.slice(0, 40)}…`);
    db().prepare("DELETE FROM sns_posts WHERE id = ?").run(draft.id);
    return null;
  }
  const record = (cost: number, error: string | null) =>
    db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (?, ?, ?, 0, 0, ?, ?)").run(p.id, `${def.label}への自動投稿`, apiId, cost, error);
  let posted: { url: string };
  try {
    posted = await def.post(draft.text, link);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    record(0, msg);
    logEvent(p.id, "system", "sns-auto-error", msg);
    if (hint) throw new Error(msg);
    return null;
  }
  db().prepare("UPDATE sns_posts SET status = 'posted', posted_at = datetime('now'), post_url = ? WHERE id = ?").run(posted.url, draft.id);
  record(def.costUsd, null);
  logEvent(p.id, "ai", "sns-post", `${def.label}に自動で投稿: ${draft.text.slice(0, 60)}… ${posted.url}`);
  return posted.url;
}
