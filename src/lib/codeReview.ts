import crypto from "node:crypto";
import { db } from "./db";
import { addProposal } from "./voices";

// コードの見直しのルーティン（クラウドの Claude Code。週に1回）が、見つけたことを提案箱の「仕組みの改善」に入れる入口（docs/routine-code-review.md）
// 提案箱が「運営の中で困ったこと（外側）」から出るのに対して、こちらは「コードの中身（内側）」から出す。直しはしない（直すのは、運営者が選んで「AIに直させる」を押したときの、提案箱のルーティン）
// - 合言葉は LAB_REVIEW_TOKEN（ツールのルーティンの LAB_TOOL_TOKEN とは分ける。ルーティンの役割ごとに、入れる入口を分けるため）
// - 入れられるのは、6日のあいだに5件まで（毎回たまって、選ぶ手間が増えないように）

export const REVIEW_SCENE = "コードの見直し";
export const REVIEW_MAX = 5;
const REVIEW_WINDOW = "-6 days";
const TITLE_MAX = 80;
const HOW_MAX = 600;
const WHY_MAX = 400;

// ルーティンが送ってきた合言葉が正しいか（比べる時間で中身が推測されないよう、最後まで比べる）
export function reviewTokenOk(header: string | null): boolean {
  const want = process.env.LAB_REVIEW_TOKEN ?? "";
  if (want.length < 32 || !header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice(7));
  const exp = Buffer.from(want);
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

// 見つけたことを提案箱に入れる。入ったものの番号と、入れなかった理由を返す
// 同じ題・同じ趣旨の提案があれば入れない（ふだんの提案と同じ仕組み。返事待ちなら「何回出たか」を数える）
export function addReviewFindings(raw: unknown): { added: number[]; skipped: string[] } {
  if (!Array.isArray(raw)) throw new Error("items は配列にしてください");
  const recent = (db().prepare("SELECT COUNT(*) AS n FROM plan_requests WHERE source = 'review' AND created_at >= datetime('now', ?)").get(REVIEW_WINDOW) as { n: number }).n;
  let room = Math.max(0, REVIEW_MAX - recent);
  const added: number[] = [];
  const skipped: string[] = [];
  raw.slice(0, REVIEW_MAX).forEach((item, i) => {
    const x = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const label = typeof x.title === "string" ? `「${x.title.slice(0, 40)}」` : `${i + 1}件目`;
    if (!isText(x.title, TITLE_MAX) || !isText(x.how, HOW_MAX) || !isText(x.why, WHY_MAX)) {
      skipped.push(`${label}: title（${TITLE_MAX}文字まで）・how（${HOW_MAX}文字まで）・why（${WHY_MAX}文字まで）がそろっていない`);
      return;
    }
    if (room <= 0) {
      skipped.push(`${label}: 6日のあいだに入れられる${REVIEW_MAX}件を超えた`);
      return;
    }
    const id = addProposal({ title: x.title, how: x.how, why: x.why, target: "system", source: "review", scene: REVIEW_SCENE, proposer: null });
    if (id === null) skipped.push(`${label}: 同じ題か同じ趣旨の提案がすでにある`);
    else {
      added.push(id);
      room--;
    }
  });
  if (raw.length > REVIEW_MAX) skipped.push(`${REVIEW_MAX}件を超えた分（${raw.length - REVIEW_MAX}件）は読んでいない`);
  return { added, skipped };
}

// 見直しの前に読む、いまの「仕組みの改善」（返事待ちと、60日のあいだに返事をしたもの）。同じことを出さないため
export function reviewContext(): { id: number; title: string; how: string | null; status: string; source: string; note: string | null }[] {
  return db().prepare(
    "SELECT id, title, how, status, source, note FROM plan_requests WHERE target = 'system' AND (status = 'open' OR decided_at >= datetime('now', '-60 days')) ORDER BY id DESC LIMIT 80",
  ).all() as { id: number; title: string; how: string | null; status: string; source: string; note: string | null }[];
}
