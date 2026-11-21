import { db } from "./db";
import { notifyHuman } from "./liveNotify";
import { logEvent } from "./loop";
import { sourceLabel, type RequestRow } from "./plan";

// 人待ち: AIが運営者にお願いした提案（提案箱の「あなたにやってほしいこと」）が、返事のないまま何日たっているか
// 臨時会議で決めた「管理者への掲載相談」が返事待ちのまま、そのあとの会議はそれがある前提で話を続けていた。
// それを待つ仕組みの改善（同じ物差しで集計）も一緒に止まっていた（運営者が、止まっているものを進めると決めた）
// - 朝会・定例会議に、待っている日数を渡す。7日以上のものは、やってもらえる前提で計画せず、AIだけでできる手を考えさせる
// - 7日たったら、運営者に一度だけ知らせる

export const WAIT_DAYS = 7;
const DAY = 86_400_000;

export type HumanWait = { id: number; title: string; days: number; source: string; notified: boolean };

export function humanWaits(now = Date.now()): HumanWait[] {
  const rows = db().prepare("SELECT * FROM plan_requests WHERE status = 'open' AND target = 'human' AND source != 'human' ORDER BY id").all() as (RequestRow & { wait_notified_at: string | null })[];
  return rows.map((r) => ({
    id: r.id, title: r.title, source: sourceLabel(r), notified: !!r.wait_notified_at,
    days: Math.max(0, Math.floor((now - Date.parse(`${r.created_at.replace(" ", "T")}Z`)) / DAY)),
  }));
}

export function waitsText(now = Date.now()): string {
  const ws = humanWaits(now);
  if (!ws.length) return "運営者の返事待ち: なし";
  const long = ws.filter((w) => w.days >= WAIT_DAYS);
  return `運営者の返事待ち（あなたたちAIが運営者にお願いしたこと。返事のないまま何日たったか）:
${ws.map((w) => `- 「${w.title}」${w.days}日待ち（${w.source}）`).join("\n")}${long.length ? `
${WAIT_DAYS}日以上待っているもの（${long.map((w) => `「${w.title}」`).join("・")}）は、やってもらえる前提で計画しない。代わりに、AIだけでできる手を考える。これを待って止まっている仕組みの改善や比べがあれば、待たずに進める形も考える` : ""}`;
}

// 7日たったお願いを、運営者に一度だけ知らせる（1時間に1回見る）
const g = globalThis as unknown as { __aiLabWaitCheck?: number };
export function notifyLongWaits(force = false, now = Date.now()): number {
  if (!force && g.__aiLabWaitCheck && now - g.__aiLabWaitCheck < 3_600_000) return 0;
  g.__aiLabWaitCheck = now;
  const due = humanWaits(now).filter((w) => w.days >= WAIT_DAYS && !w.notified);
  if (!due.length) return 0;
  const mark = db().prepare("UPDATE plan_requests SET wait_notified_at = datetime('now') WHERE id = ?");
  for (const w of due) mark.run(w.id);
  const list = due.map((w) => `「${w.title}」（${w.days}日）`).join("・");
  logEvent(null, "system", "human-wait", `提案箱で、運営者へのお願い${due.length}件が${WAIT_DAYS}日以上返事待ちです: ${list}`);
  notifyHuman(`提案箱で、${list}が返事待ちです。やるか見送るかを決めてください（決めるまで、AIはこれを当てにせずに計画します）`);
  return due.length;
}
