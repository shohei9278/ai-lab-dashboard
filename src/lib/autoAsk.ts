import { aiFixConfigured, aiFixSending, aiFixSyncOk, startAiFix } from "./aiFix";
import { GROWTH_SCENE, REVIEW_SCENE } from "./codeReview";
import { db, getSettings } from "./db";
import { logEvent } from "./loop";
import type { Fetch } from "./routine";

// 提案箱の「仕組みの改善」を、運営者が押さなくても、自動でルーティンに頼む（運営者が決めた。人の出番を減らす4つ目と、その続き）
// - 一度に頼むのは1件だけ（前に頼んだ PR がまだ開いている・PR ができていない間は頼まない）。終わったら、次の見回り（1時間に1回）で次を頼む
// - 全部合わせて1日（24時間）に DAILY_MAX 件まで（暴走したときの歯止め。種類ごとの上限はやめた。運営者が「1日1件だと遅い」と言い、決めた。たまっていたので、運営者が4件から6件に上げた）
// - 頼む順:
//   1. コードの見直しの守り（直すべき所）: 入ってから1日たっても見送られなければ（その間に運営者が見送れば頼まない）
//   2. 運営者が書いた提案: 入ってから1時間たっても見送られなければ（書いてすぐ頼まれると、取り消す間がないため）
//   3. 採点の点が7点以上の提案（見直しの攻め・AIの社員・会議・エラーの見張りなど）: 点の高い順・入った日時の古い順
//   （点は、採点した社（AIの社員が出した提案は、出した社を除く2社）の点を、採点者ごとの甘さ・辛さをならして平均したもの。weekly.ts の adjustScores。
//    朝会の仮の点は2社以上の点がそろったときだけ付くので、「3社の平均」とは書かない）
//   （3・4 の点は定例会議の点。朝会の仮の点（provisionalScore.ts）は、7点以上のときだけ 3 に入れる）
//   4. 5点以上7点未満の提案: 7点以上がなくなってから、点の高い順（5点未満は定例会議が自動で見送る。5〜7点が頼まれも見送られもせずにたまっていたため。運営者が決めた）
// - 頼まれたルーティンが「直さなくて良い」と判断したら、見送りにする（/api/code-review/skip。docs/routine-proposal-fix.md）
// - できた PR は、自動マージ（scripts/auto-merge.ts）が、CI と GPT・Gemini のレビューを見てマージする
// - 設定の「提案箱の提案を自動で頼む」で切れる。緊急停止の間・PR の状態の読み直しに失敗している間は頼まない
export const GROWTH_MIN_SCORE = 7;
export const AUTO_MIN_SCORE = 5;
export const DAILY_MAX = 6;
const FIX_WAIT = "-1 day";
const HUMAN_WAIT = "-1 hour";

type Row = { id: number; title: string; scene: string; score: number | null; source?: string; score_provisional?: number };
export type AutoKind = "auto-fix" | "auto-growth" | "auto-box";

const ASK_KINDS = "('auto-ask-fix', 'auto-ask-growth', 'auto-ask-box')";

// PR ができないまま待つ長さ。ルーティンはふだん10〜30分で PR を作る。直さなくて良いと判断したのに見送りを登録できなかったときなど、
// 黙って終わったルーティンで、次の依頼が長く止まらないように（1日から短くした。#93 で約1日止まった。運営者が決めた）
export const NO_PR_WAIT_HOURS = 3;

// 頼んだ改善のうち、まだ進んでいるもの（PR が開いている・頼んでから NO_PR_WAIT_HOURS 時間のあいだ PR が見つかっていない）
// 提案を見送ったあとも、PR が開いている間は数える（PR #154 の ai-review の指摘）。PR の状態は、開いている間は提案の返事に関係なく読み直す（aiFix.ts の syncAiFixPrs）
// PR がまだないものは、返事待ちの間だけ数える（ルーティンが見送ったら、すぐ次を頼めるように。PR #155 の ai-review の指摘）
function busyRow(): { id: number; title: string; ai_fix_at: string; ai_fix_pr: number | null } | undefined {
  return db().prepare("SELECT id, title, ai_fix_at, ai_fix_pr FROM plan_requests WHERE ai_fix_at IS NOT NULL AND (ai_fix_pr_state = 'open' OR (status = 'open' AND ai_fix_pr IS NULL AND ai_fix_at >= datetime('now', ?))) ORDER BY ai_fix_at DESC LIMIT 1").get(`-${NO_PR_WAIT_HOURS} hours`) as { id: number; title: string; ai_fix_at: string; ai_fix_pr: number | null } | undefined;
}

// 直近24時間に自動で頼んだ日時（古い順）。自動で頼んだ回数は、上書きされない記録（events）で数える
// （人が頼み直すと提案の欄は上書きされる。記録の文で見分けると、題の言葉で取り違える。PR #154 の ai-review の指摘）
function askedLastDay(): string[] {
  return (db().prepare(`SELECT at FROM events WHERE kind IN ${ASK_KINDS} AND at >= datetime('now', '-1 day') ORDER BY at`).all() as { at: string }[]).map((r) => r.at);
}

// 頼む順で、いちばん先の提案（進んでいるか・上限かは見ない）と、頼める状態の提案の数
function candidate(): { next: { row: Row; why: string; kind: AutoKind } | null; waiting: number } {
  const open = "target = 'system' AND status = 'open' AND ai_fix_at IS NULL";
  const fixes = db().prepare(`SELECT id, title, scene, score FROM plan_requests WHERE source = 'review' AND scene = ? AND ${open} AND created_at <= datetime('now', ?) ORDER BY repeats DESC, created_at, id`).all(REVIEW_SCENE, FIX_WAIT) as Row[];
  const humans = db().prepare(`SELECT id, title, scene, score FROM plan_requests WHERE source = 'human' AND ${open} AND created_at <= datetime('now', ?) ORDER BY created_at, id`).all(HUMAN_WAIT) as Row[];
  // 採点で決めるもの（見直しの攻め・AIの社員・会議など）。見直しの守りは、採点されても上の待ちで頼む
  // 朝会の仮の点（provisionalScore.ts）は、7点以上のものだけ頼む（重要そうなものを月曜を待たずに直す。5〜7点は、月曜の定例会議の正式な点を待つ。運営者が決めた）
  const scored = db().prepare(`SELECT id, title, scene, score, source, score_provisional FROM plan_requests WHERE source != 'human' AND NOT (source = 'review' AND scene = ?) AND ${open} AND score >= ? AND (score_provisional = 0 OR score >= ?) ORDER BY score DESC, created_at, id`).all(REVIEW_SCENE, AUTO_MIN_SCORE, GROWTH_MIN_SCORE) as Row[];
  const waiting = fixes.length + humans.length + scored.length;
  if (fixes[0]) return { next: { row: fixes[0], why: "自動: コードの見直しの守りの提案で、1日たっても見送られなかった", kind: "auto-fix" }, waiting };
  if (humans[0]) return { next: { row: humans[0], why: "自動: 運営者が書いた提案で、1時間たっても見送られなかった", kind: "auto-box" }, waiting };
  const top = scored[0];
  if (!top) return { next: null, waiting };
  const growth = top.source === "review" && top.scene === GROWTH_SCENE;
  const low = top.score! < GROWTH_MIN_SCORE ? `（${GROWTH_MIN_SCORE}点未満。${GROWTH_MIN_SCORE}点以上の提案がなくなったので頼む）` : "";
  return { next: { row: top, why: `自動: ${growth ? "コードの見直しの攻めの提案" : "提案箱の提案"}で、${top.score_provisional ? `朝会の仮の採点で${top.score!.toFixed(1)}点（7点以上なので、月曜の定例会議を待たずに頼む）` : `定例会議の採点で${top.score!.toFixed(1)}点${low}`}`, kind: growth ? "auto-growth" : "auto-box" }, waiting };
}

// 次に自動で頼む提案（なければ null）と、その理由
export function nextAutoAsk(): { row: Row; why: string; kind: AutoKind } | null {
  // 頼んだ改善が進んでいる間は、次を頼まない
  if (busyRow()) return null;
  if (askedLastDay().length >= DAILY_MAX) return null;
  return candidate().next;
}

// 提案箱の画面に出す、自動の依頼の今の様子（運営者が決めた。止まっているのか、待っているのかを分かるように）
export type AutoAskStatus = {
  off: string | null; // 止めている理由（設定・緊急停止・つながっていない）。動いていれば null
  busy: { id: number; title: string; at: string; pr: number | null; giveUpAt: string | null } | null; // 頼んで進んでいるもの（giveUpAt: PR がまだないとき、待つのをやめる日時。ISO）
  asked: number; max: number; // 直近24時間に頼んだ数と上限
  resumeAt: string | null; // 上限に達しているとき、次に頼めるようになる日時（UTC）
  next: { id: number; title: string; why: string } | null; // 次に頼む提案
  waiting: number; // 頼める状態の提案の数
  nextCheckAt: number | null; // 次に見る時刻（ms）。サーバーが立ち上がってからまだ見ていなければ null（次の見回り）
};
export function autoAskStatus(): AutoAskStatus {
  const s = getSettings();
  const off = !s.autoAskReview ? "設定の「提案箱の提案を自動で頼む」がオフ" : s.killSwitch ? "緊急停止中" : !aiFixConfigured() ? "提案箱の改善を直すルーティンにつながっていない" : !aiFixSyncOk() ? "PR の状態を GitHub から読み直せていない（読めるようになるまで頼まない）" : null;
  const b = busyRow();
  const asked = askedLastDay();
  const c = candidate();
  const resumeAt = asked.length >= DAILY_MAX ? new Date(Date.parse(`${asked[asked.length - DAILY_MAX].replace(" ", "T")}Z`) + 86_400_000).toISOString() : null;
  return {
    off,
    busy: b ? { id: b.id, title: b.title, at: b.ai_fix_at, pr: b.ai_fix_pr, giveUpAt: b.ai_fix_pr ? null : new Date(Date.parse(`${b.ai_fix_at.replace(" ", "T")}Z`) + NO_PR_WAIT_HOURS * 3_600_000).toISOString() } : null,
    asked: asked.length, max: DAILY_MAX, resumeAt,
    next: c.next ? { id: c.next.row.id, title: c.next.row.title, why: c.next.why } : null,
    waiting: c.waiting,
    nextCheckAt: g.__aiLabAutoAskAt ? g.__aiLabAutoAskAt + 3_600_000 : null,
  };
}

// 定期の処理から呼ぶ（1時間に1回）。頼んだら true
const g = globalThis as unknown as { __aiLabAutoAskAt?: number };
export async function maybeAutoAsk(fetchImpl: Fetch = fetch, force = false): Promise<boolean> {
  if (!force && g.__aiLabAutoAskAt && Date.now() - g.__aiLabAutoAskAt < 3_600_000) return false;
  // 人の依頼を送っている途中なら、今回は見送る（次の見回りで、その依頼を数えて決める）
  if (aiFixSending()) return false;
  // PR の状態の読み直しに失敗している間は頼まない（GitHub にある PR を数えそこねて、2件目を頼まないように。PR #154 の ai-review の指摘）
  if (!aiFixSyncOk()) return false;
  g.__aiLabAutoAskAt = Date.now();
  const s = getSettings();
  if (!s.autoAskReview || s.killSwitch || !aiFixConfigured()) return false;
  const next = nextAutoAsk();
  if (!next) return false;
  try {
    await startAiFix(next.row.id, next.why, fetchImpl, next.kind);
    return true;
  } catch (e) {
    logEvent(null, "system", "auto-ask-error", `提案箱の「${next.row.title}」を自動で頼めませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    return false;
  }
}
