import crypto from "node:crypto";
import { db } from "./db";
import { addProposal, countRepeat } from "./voices";

// コードの見直しのルーティン（クラウドの Claude Code。毎日1回。運営者が決めた）が、見つけたことを提案箱の「仕組みの改善」に入れる入口（docs/routine-code-review.md）
// 提案箱が「運営の中で困ったこと（外側）」から出るのに対して、こちらは「コードの中身（内側）」から出す。直しはしない（直すのは、運営者が選んで「AIに直させる」を押したときの、提案箱のルーティン）
// - 合言葉は LAB_REVIEW_TOKEN（ツールのルーティンの LAB_TOOL_TOKEN とは分ける。ルーティンの役割ごとに、入れる入口を分けるため）
// - 入れられるのは、1回の見直しで4件まで（攻めは2件まで）。11/27 に運営者が、週2回・1回8件から、毎日・1回4件に変えた
//   （提案を受けて直す側に余裕があり、7点以上の提案がなくなって5点台まで頼んでいたため。間を詰めて、1回の数は絞る）
//   前の回の分を数えないよう、20時間のあいだで数える（毎日同じ時刻に動くが、起動の時刻は数分ずれるので、24時間だと前の回の分が残る）

export const REVIEW_SCENE = "コードの見直し";
// 攻め: 直すべき所（守り）ではなく、実験を伸ばすために足すとよい機能。定例会議で3社が採点し、点の高いものを自動でルーティンに頼む（autoAsk.ts）
export const GROWTH_SCENE = "コードの見直し（攻め）";
export const REVIEW_MAX = 4;
export const GROWTH_MAX = 2; // 4件のうち、攻めは2件まで
export const REVIEW_WINDOW = "-20 hours";
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
  const recentGrowth = (db().prepare("SELECT COUNT(*) AS n FROM plan_requests WHERE source = 'review' AND scene = ? AND created_at >= datetime('now', ?)").get(GROWTH_SCENE, REVIEW_WINDOW) as { n: number }).n;
  let room = Math.max(0, REVIEW_MAX - recent);
  let growthRoom = Math.max(0, GROWTH_MAX - recentGrowth);
  const added: number[] = [];
  const skipped: string[] = [];
  raw.slice(0, REVIEW_MAX).forEach((item, i) => {
    const x = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const label = typeof x.title === "string" ? `「${x.title.slice(0, 40)}」` : `${i + 1}件目`;
    if (!isText(x.title, TITLE_MAX) || !isText(x.how, HOW_MAX) || !isText(x.why, WHY_MAX)) {
      skipped.push(`${label}: title（${TITLE_MAX}文字まで）・how（${HOW_MAX}文字まで）・why（${WHY_MAX}文字まで）がそろっていない`);
      return;
    }
    const growth = x.kind === "growth";
    if (x.kind !== undefined && x.kind !== "fix" && !growth) {
      skipped.push(`${label}: kind は fix（守り）か growth（攻め）にしてください`);
      return;
    }
    // 上限に達していても、同じ趣旨の提案が返事待ちなら「何回出たか」は数える（PR #141 の ai-review の指摘。攻めの上限のときも同じ。PR #154 の ai-review の指摘）
    const full = growth && growthRoom <= 0 ? `1回の見直しで入れられる攻めの${GROWTH_MAX}件を超えた` : room <= 0 ? `1回の見直しで入れられる${REVIEW_MAX}件を超えた` : null;
    if (full) {
      const p = { title: x.title, how: x.how, target: "system" as const, source: "review" as const };
      skipped.push(countRepeat(p) ? `${label}: 同じ題か同じ趣旨の提案がすでにある` : `${label}: ${full}`);
      return;
    }
    const id = addProposal({ title: x.title, how: x.how, why: x.why, target: "system", source: "review", scene: growth ? GROWTH_SCENE : REVIEW_SCENE, proposer: null });
    if (id === null) skipped.push(`${label}: 同じ題か同じ趣旨の提案がすでにある`);
    else {
      added.push(id);
      room--;
      if (growth) growthRoom--;
    }
  });
  if (raw.length > REVIEW_MAX) skipped.push(`${REVIEW_MAX}件を超えた分（${raw.length - REVIEW_MAX}件）は読んでいない`);
  return { added, skipped };
}

// 見直しの前に読む、いまの「仕組みの改善」（返事待ちと、60日のあいだに返事をしたもの）。同じことを出さないため
// 件数で切らない（切ると古いものが抜けて、同じ提案をまた出すため。PR #141 の ai-review の指摘）
export function reviewContext(): { id: number; title: string; how: string | null; status: string; source: string; scene: string | null; score: number | null; note: string | null }[] {
  return db().prepare(
    "SELECT id, title, how, status, source, scene, score, note FROM plan_requests WHERE target = 'system' AND (status = 'open' OR decided_at >= datetime('now', '-60 days')) ORDER BY id DESC",
  ).all() as { id: number; title: string; how: string | null; status: string; source: string; scene: string | null; score: number | null; note: string | null }[];
}
