import { db } from "./db";
import { jstDay } from "./sns";
import { logEvent } from "./loop";

// 当たりの兆し（運営者が決めた）: 昨日（日本時間）、普段より訪問か利用が跳ねた公開中の案件
// 見つけた日の朝会は、新しい案件づくりを休み、その案件に集中する（宣伝の切り口を変える・ツールの直し）。
// 次のアイデア出しには、最近跳ねた案件の派生（同じ仕組みを別の対象者に・同じ対象者の別の困りごと）を候補として渡す。
// 訪問が少ない今は数字の揺れが大きいので、下限（訪問10人・利用3人）と、普段の3倍の両方を満たしたときだけにする。
// 普段 = 昨日より前の7日のうち、公開していた日の1日あたり。公開していた日が3日に満たない案件は、比べられないので見ない
export const HOT_MIN_VISITS = 10;
export const HOT_MIN_CONVERSIONS = 3;
export const HOT_RATIO = 3;
const BASE_DAYS = 7;
const BASE_MIN_DAYS = 3;
const HOT_MAX = 2;

export type HotProject = { id: number; title: string; visits: number; conversions: number; baseVisits: number; baseConversions: number; why: string };

const dayOf = (now: number, back: number) => jstDay(new Date(now - back * 86_400_000));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function hotProjects(now = Date.now()): HotProject[] {
  const yesterday = dayOf(now, 1);
  const from = dayOf(now, 1 + BASE_DAYS);
  const to = dayOf(now, 2);
  const rows = db().prepare("SELECT id, title, published_at FROM projects WHERE stage = 'live' AND demo = 0 AND public_slug IS NOT NULL ORDER BY id").all() as { id: number; title: string; published_at: string | null }[];
  const sum = db().prepare("SELECT COALESCE(SUM(visits), 0) AS v, COALESCE(SUM(signups), 0) AS c FROM metrics WHERE project_id = ? AND day >= ? AND day <= ? AND source != 'simulated'");
  const hot: (HotProject & { ratio: number })[] = [];
  for (const p of rows) {
    if (!p.published_at) continue;
    // 普段に数える日は、公開した日の翌日から（公開した日は途中からなので数えない）
    const pubDay = jstDay(new Date(Date.parse(`${p.published_at.replace(" ", "T")}Z`)));
    const start = pubDay >= from ? dayOf(Date.parse(`${pubDay}T12:00:00+09:00`), -1) : from;
    if (start > to) continue;
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
    if (days < BASE_MIN_DAYS) continue;
    const y = sum.get(p.id, yesterday, yesterday) as { v: number; c: number };
    const b = sum.get(p.id, start, to) as { v: number; c: number };
    const baseV = b.v / days;
    const baseC = b.c / days;
    const rv = y.v / Math.max(baseV, 1);
    const rc = y.c / Math.max(baseC, 1);
    const byVisits = y.v >= HOT_MIN_VISITS && rv >= HOT_RATIO;
    const byConv = y.c >= HOT_MIN_CONVERSIONS && rc >= HOT_RATIO;
    if (!byVisits && !byConv) continue;
    const why = [
      byVisits ? `訪問${y.v}人（普段は1日${round1(baseV)}人）` : "",
      byConv ? `利用・登録${y.c}人（普段は1日${round1(baseC)}人）` : "",
    ].filter(Boolean).join("・");
    hot.push({ id: p.id, title: p.title, visits: y.v, conversions: y.c, baseVisits: round1(baseV), baseConversions: round1(baseC), why: `昨日 ${why}`, ratio: Math.max(byVisits ? rv : 0, byConv ? rc : 0) });
  }
  return hot.sort((a, b) => b.ratio - a.ratio).slice(0, HOT_MAX).map((h) => ({ id: h.id, title: h.title, visits: h.visits, conversions: h.conversions, baseVisits: h.baseVisits, baseConversions: h.baseConversions, why: h.why }));
}

// 見つけた案件を記録する（次のアイデア出しの hotIdeaHint が読む）。同じ日（日本時間）・同じ案件は1件だけ（計画を作り直しても増やさない）
export function recordHot(hot: HotProject[], day: string) {
  for (const h of hot) {
    if (db().prepare("SELECT 1 FROM events WHERE kind = 'hot-project' AND project_id = ? AND date(at, '+9 hours') = ?").get(h.id, day)) continue;
    logEvent(h.id, "system", "hot-project", `当たりの兆し（${h.why}）。今日は新しい案件づくりを休み、この案件に集中します`);
  }
}

// 朝会の材料
export function hotText(hot: HotProject[]): string {
  if (!hot.length) return "当たりの兆し（昨日、普段より訪問か利用が跳ねた案件）: なし";
  return `当たりの兆し（昨日、普段より訪問か利用が跳ねた案件。今日は新しい案件づくりを休み、ここに集中する）:\n${hot.map((h) => `- #${h.id} ${h.title}: ${h.why}`).join("\n")}`;
}

// 朝会の「新しい案件づくりを休む」理由
export const hotPauseReason = (hot: HotProject[]) =>
  `当たりの兆し（${hot.map((h) => `#${h.id} ${h.title}: ${h.why}`).join(" / ")}）。新しい案件づくりを休み、この案件に集中する`;

// アイデア出しの材料: 直近7日に跳ねた案件（朝会が見つけたときに events に残す）
export function hotIdeaHint(): string {
  const rows = db().prepare(
    `SELECT DISTINCT p.id, p.title, p.target FROM events e JOIN projects p ON p.id = e.project_id
     WHERE e.kind = 'hot-project' AND e.at >= datetime('now', '-7 days') AND p.demo = 0 ORDER BY e.id DESC LIMIT 3`,
  ).all() as { id: number; title: string; target: string }[];
  if (!rows.length) return "";
  return `\n\n最近、訪問や利用が普段より跳ねた案件（派生を考えてよい: 同じ仕組みを別の対象者に・同じ対象者の別の困りごとに。同じものの言い換えにはしない）:\n${rows.map((r) => `- #${r.id} ${r.title}（対象: ${r.target}）`).join("\n")}`;
}
