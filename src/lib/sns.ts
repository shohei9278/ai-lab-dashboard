import crypto from "node:crypto";
import { callJson, isObj, isStr } from "./ai";
import { db } from "./db";
import { CONV, KIND_LABEL, getProject, logEvent, type Lp } from "./loop";
import { publicUrl } from "./publish";

// SNSへの投稿。投稿そのものは、あなたのアカウントから行う（画面からXの投稿画面を開く）。
// 投稿ごとに専用のリンクを付けるので、どの投稿から何人来て、何人が登録・利用したかが分かる

export type SnsPost = {
  id: number; created_at: string; project_id: number; platform: string; code: string; angle: string | null; text: string;
  author: "ai" | "human"; status: "draft" | "posted"; posted_at: string | null; post_url: string | null;
  impressions: number | null; visits: number; conversions: number;
};

// X の文字数の数え方: 日本語などは1文字を2と数え、URLは長さに関係なく23と数える。上限は280
export function xWeightedLength(text: string, withUrl = true): number {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const light = c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
    n += light ? 1 : 2;
  }
  return n + (withUrl ? 1 + 23 : 0);
}
export const X_LIMIT = 280;

export function postLink(projectId: number, code: string): string | null {
  const base = publicUrl(projectId);
  return base ? `${base}?s=${code}` : null;
}

export function listPosts(projectId: number): SnsPost[] {
  return db().prepare("SELECT * FROM sns_posts WHERE project_id = ? ORDER BY status = 'posted', id DESC").all(projectId) as SnsPost[];
}

const newCode = () => crypto.randomBytes(4).toString("hex").slice(0, 6);

export function addPost(projectId: number, text: string, author: "ai" | "human", angle: string | null = null): number {
  return Number(
    db().prepare("INSERT INTO sns_posts (project_id, code, angle, text, author) VALUES (?, ?, ?, ?, ?)").run(projectId, newCode(), angle, text, author).lastInsertRowid,
  );
}

// AIに、切り口の違う投稿の下書きをいくつか作らせる
export async function draftPosts(projectId: number, count: number, hint?: string): Promise<number[]> {
  const p = getProject(projectId);
  if (!p?.lp) throw new Error("まだLPやツールがありません");
  const lp = JSON.parse(p.lp) as Lp;
  const past = listPosts(projectId).filter((x) => x.status === "posted").map((x) => `- ${x.text}（訪問 ${x.visits}人・${CONV[p.kind].noun} ${x.conversions}人）`).join("\n") || "（まだなし）";
  const isTool = p.kind === "tool";
  const out = await callJson<{ posts: { angle: string; text: string }[] }>({
    purpose: "SNS投稿の下書き",
    projectId,
    system: `あなたはX（旧Twitter）で、個人が作った小さな${isTool ? "Webツール" : "サービス"}を紹介する投稿を書く担当です。
投稿にはリンクが自動で付くので、本文にURLは書かない。
守ること:
- 1件あたり日本語で110文字以内（リンクを付けても280の上限に収まるように）
- ${isTool ? "無料・登録不要でその場で使えることが伝わるようにする" : "まだ準備中で、事前登録を受け付けていることを正直に書く（すでに使えるとは書かない）"}
- 架空の利用者数・実績・お客様の声、効果の断言、誇大表現、他人になりすました書き方はしない
- ページに書かれている機能・特徴だけを書く（書かれていないことを、できるかのように書かない）
- ハッシュタグは使っても1つまで。絵文字は控えめに
- 押し付けがましい宣伝ではなく、対象の人が「自分のことだ」と思う書き出しにする
- 投稿ごとに切り口を変える（例: 困りごとへの共感 / 使い方の具体例 / 作った理由 / 問いかけ）
これまでの投稿と反応がある場合は、反応が良かった切り口を参考にし、同じ文は避ける。
形式: {"posts":[{"angle":"切り口を短く","text":"本文"}]}`,
    user: `${KIND_LABEL[p.kind]}: ${p.title}\n対象: ${p.target}\n困りごと・動機: ${p.problem}\n中身: ${p.solution}\nページの見出し: ${lp.headline}\nページの補足: ${lp.subheadline}\nページに書かれている特徴: ${lp.features.map((f) => `${f.title}（${f.body}）`).join(" / ")}\n件数: ${count}${hint ? `\n今回の希望: ${hint}` : ""}\n\nこれまでの投稿と反応:\n${past}`,
    validate: (v): v is { posts: { angle: string; text: string }[] } =>
      isObj(v) && Array.isArray(v.posts) && v.posts.length > 0 && v.posts.every((x) => isObj(x) && isStr(x.text)),
  });
  const ids = out.posts.slice(0, count).map((x) => addPost(projectId, x.text.trim().slice(0, 280), "ai", typeof x.angle === "string" ? x.angle.slice(0, 40) : null));
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
  logEvent(p.project_id, "human", "sns-post", `Xに投稿: ${(text ?? p.text).slice(0, 60)}…`);
}

export function setPostStats(id: number, v: { postUrl?: string; impressions?: number | null }) {
  getPost(id);
  if (v.postUrl !== undefined) {
    const url = v.postUrl.trim();
    if (url && !/^https:\/\/(x|twitter)\.com\/[^\s]+$/.test(url)) throw new Error("X の投稿のURL（https://x.com/…）を入れてください");
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
