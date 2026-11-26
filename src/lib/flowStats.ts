import { db } from "./db";
import { logEvent } from "./loop";

// 仕組みの詰まり（運営者が決めた）: 工程ごとに、どれだけの時間止まっていたかを、記録から数える（AIは呼ばない）
// これまでは「じっくり案件が8件たまっている」のような詰まりを、運営者が気づいて仕組みを変えていた。件数だけでは、
// 「人の承認待ちが10件あっても各5分で進む」のか「直しの待ちが2件だけで各3日止まる」のかが分からない。
// そこで、工程ごとに直近7日に止まっていた時間の合計・いま待っているもの・いちばん長いものを出し、
// 定例会議の材料にして、AIが詰まりを自分で見つけて改善案を出せるようにする。急に増えたら知らせる
// 工程は、入った時刻と終わった時刻がすでに残っている記録から数える
// - 人の判断待ち: 承認（アイデア・公開・判断・データの確認）が出てから、人が決めるまで
// - 開発待ち: じっくり案件などのツールを Claude Code で作る承認が出てから、入るまで
// - 運営者へのお願い: AIが運営者にお願いした提案が出てから、返事があるまで
// - 提案箱の依頼待ち: 仕組みの改善の提案が入ってから、ルーティンに頼む（か見送る）まで
// - 提案箱の直し: ルーティンに頼んでから、PR がマージされる（か見送る）まで

export type FlowStage = "judge" | "dev" | "ask" | "boxWait" | "boxFix";
export const FLOW_STAGE_LABEL: Record<FlowStage, string> = {
  judge: "人の判断待ち",
  dev: "開発待ち（Claude Code でツールを作る）",
  ask: "運営者へのお願い",
  boxWait: "提案箱の依頼待ち",
  boxFix: "提案箱の直し（ルーティンからマージまで）",
};
export const FLOW_STAGES = Object.keys(FLOW_STAGE_LABEL) as FlowStage[];
const JUDGE_KIND_LABEL: Record<string, string> = { idea: "アイデアの承認", publish: "公開の承認", decision: "判断", data: "データの確認" };

// 1件の待ち（end が空なら、まだ待っている）
type Item = { stage: FlowStage; start: number; end: number | null; title: string };

const HOUR = 3_600_000;
const WINDOW_DAYS = 7;
const ms = (s: string | null) => (s ? Date.parse(`${s.replace(" ", "T")}Z`) : NaN);

function items(): Item[] {
  const out: Item[] = [];
  // 承認: 決まったのに決めた時刻のないもの（古い記録など）は、いつまで待ったか分からないので数えない
  const approvals = db().prepare(
    "SELECT a.kind, a.status, a.created_at, a.decided_at, p.id AS pid, p.title FROM approvals a LEFT JOIN projects p ON p.id = a.project_id WHERE p.demo IS NULL OR p.demo = 0",
  ).all() as { kind: string; status: string; created_at: string; decided_at: string | null; pid: number | null; title: string | null }[];
  for (const a of approvals) {
    const stage: FlowStage | null = a.kind === "dev" ? "dev" : a.kind in JUDGE_KIND_LABEL ? "judge" : null;
    const start = ms(a.created_at);
    if (!stage || !Number.isFinite(start)) continue;
    const end = a.status === "pending" ? null : ms(a.decided_at);
    if (end !== null && !Number.isFinite(end)) continue;
    out.push({ stage, start, end, title: `${stage === "judge" ? `${JUDGE_KIND_LABEL[a.kind]}: ` : ""}#${a.pid ?? "?"} ${a.title ?? ""}`.trim() });
  }
  const reqs = db().prepare("SELECT title, target, source, status, created_at, decided_at, ai_fix_at FROM plan_requests").all() as
    { title: string; target: string; source: string; status: string; created_at: string; decided_at: string | null; ai_fix_at: string | null }[];
  for (const r of reqs) {
    const created = ms(r.created_at);
    const decided = r.status === "open" ? null : ms(r.decided_at);
    if (!Number.isFinite(created) || (decided !== null && !Number.isFinite(decided))) continue;
    if (r.target === "human") {
      // 運営者が自分で書いた提案は、運営者が待っているのではないので数えない
      if (r.source !== "human") out.push({ stage: "ask", start: created, end: decided, title: r.title });
      continue;
    }
    const asked = ms(r.ai_fix_at);
    if (Number.isFinite(asked)) {
      out.push({ stage: "boxWait", start: created, end: asked, title: r.title });
      out.push({ stage: "boxFix", start: asked, end: decided, title: r.title });
    } else {
      out.push({ stage: "boxWait", start: created, end: decided, title: r.title });
    }
  }
  return out;
}

export type FlowRow = {
  stage: FlowStage; label: string;
  hours: number; // 直近7日に止まっていた時間の合計（7日の中にかかる分だけ）
  prevHours: number; // その前の7日の合計
  entered: number; // 直近7日に入った件数
  finished: number; // 直近7日に終わった件数
  avgHours: number | null; // 直近7日に終わったものの、入ってから終わるまでの平均
  waiting: number; // いま待っている件数
  oldest: { hours: number; title: string }[]; // いま待っているもののうち、長いもの（3件まで）
};

const overlap = (it: Item, from: number, to: number) => Math.max(0, Math.min(it.end ?? to, to) - Math.max(it.start, from));

export function flowStats(now = Date.now()): FlowRow[] {
  const all = items();
  const from = now - WINDOW_DAYS * 24 * HOUR;
  const prevFrom = from - WINDOW_DAYS * 24 * HOUR;
  return FLOW_STAGES.map((stage) => {
    const its = all.filter((x) => x.stage === stage && x.start <= now);
    const done = its.filter((x) => x.end !== null && x.end >= from && x.end <= now);
    const open = its.filter((x) => x.end === null).sort((a, b) => a.start - b.start);
    return {
      stage, label: FLOW_STAGE_LABEL[stage],
      hours: its.reduce((n, x) => n + overlap(x, from, now), 0) / HOUR,
      prevHours: its.reduce((n, x) => n + overlap(x, prevFrom, from), 0) / HOUR,
      entered: its.filter((x) => x.start >= from).length,
      finished: done.length,
      avgHours: done.length ? done.reduce((n, x) => n + (x.end! - x.start), 0) / done.length / HOUR : null,
      waiting: open.length,
      oldest: open.slice(0, 3).map((x) => ({ hours: (now - x.start) / HOUR, title: x.title })),
    };
  });
}

// 時間の見せ方: 1時間に満たなければ「1時間未満」、48時間までは時間、それより長ければ日
export const durText = (h: number) => (h <= 0 ? "0時間" : h < 1 ? "1時間未満" : h < 48 ? `${Math.round(h)}時間` : `${(h / 24).toFixed(1)}日`);

// 定例会議の材料（weekly.ts の meetingMaterial）
export function flowText(now = Date.now()): string {
  const rows = flowStats(now);
  if (rows.every((r) => !r.hours && !r.prevHours && !r.waiting)) return "仕組みの詰まり（工程ごとに止まっていた時間）: まだ記録がない";
  return `仕組みの詰まり（工程ごとに、直近7日に止まっていた時間の合計。件数より、止まった時間の長さで直す価値を見る。記録から数えた）:
${rows.map((r) => `- ${r.label}: 合計${durText(r.hours)}（その前の7日は${durText(r.prevHours)}）・入った${r.entered}件・終わった${r.finished}件${r.avgHours === null ? "" : `（入ってから終わるまで平均${durText(r.avgHours)}）`}・いま待っている${r.waiting}件${r.oldest.length ? `（長いもの: ${r.oldest.map((o) => `「${o.title.slice(0, 40)}」${durText(o.hours)}`).join("・")}）` : ""}`).join("\n")}
止まった時間の合計が多い工程・長く止まっているものがあれば、その工程を短くする仕組みの改善を出してよい（人の手を減らす向き。待っている理由が人の返事なら、人がいなくても進む形を考える）`;
}

// 止まっていた時間が急に増えたら知らせる（1週に1回まで。月曜の定例会議を待たずに気づけるように。AIは呼ばない）
// 直近7日の合計が、その前の7日の2倍以上で、かつ FLOW_ALERT_HOURS 以上増えた工程があるとき
export const FLOW_ALERT_HOURS = 48;
export function checkFlowJump(now = Date.now()): string | null {
  const up = flowStats(now).filter((r) => r.hours - r.prevHours >= FLOW_ALERT_HOURS && r.hours >= r.prevHours * 2);
  if (!up.length) return null;
  const week = (db().prepare("SELECT date('now', '+9 hours', '-6 days', 'weekday 1') AS w").get() as { w: string }).w;
  const mark = `（${week} の週）`;
  if (db().prepare("SELECT 1 FROM events WHERE kind = 'flow-alert' AND message LIKE ?").get(`%${mark}%`)) return null;
  const msg = `仕組みの詰まりが増えています${mark}: ${up.map((r) => `${r.label}が直近7日で合計${durText(r.hours)}（その前の7日は${durText(r.prevHours)}・いま待っている${r.waiting}件）`).join("・")}。AIの成績の「仕組みの詰まり」で、長く止まっているものを見てください`;
  logEvent(null, "system", "flow-alert", msg);
  return msg;
}
