import type { ProjectRow, Settings } from "./db";
import { AIMS, AIM_KEYS, aimWeightsOf, isAim, type Aim } from "./aims";

// 判断に入る基準（訪問の人数と、訪問が少なくても判断する日数）を、ねらいごとに決める（11/26 に運営者が決めた）
// - ねらいごとの値は運営者が設定の画面で決める。0 は「一括の値（judgeMinVisits・judgeAfterDays）を使う」
// - 案件ごとの調整は、アイデアを案件にするときだけ（公開の前）。ねらいの基準の半分〜1.5倍の範囲で、理由と一緒に残す。数字が出てからは変えない
//   （伸びていない案件の判断を、あとから先に延ばせないように）
// - 基準の見直しは、週の定例会議でAIが提案箱に出し、運営者が設定の画面で変える（AIは設定を書き換えない）

export const AIM_JUDGE_KEYS = {
  spread: { visits: "judgeVisitsSpread", days: "judgeDaysSpread" },
  useful: { visits: "judgeVisitsUseful", days: "judgeDaysUseful" },
  return: { visits: "judgeVisitsReturn", days: "judgeDaysReturn" },
  demand: { visits: "judgeVisitsDemand", days: "judgeDaysDemand" },
} as const satisfies Record<Aim, { visits: keyof Settings; days: keyof Settings }>;

export const ADJUST_RANGE = { min: 0.5, max: 1.5 };

type JudgeSettings = Pick<Settings, "judgeMinVisits" | "judgeAfterDays" | (typeof AIM_JUDGE_KEYS)[Aim]["visits"] | (typeof AIM_JUDGE_KEYS)[Aim]["days"]>;

// ねらいのない古い案件は、ツールなら「役に立つ」、LP なら「需要を確かめる」の基準を使う
export function judgeAim(p: Pick<ProjectRow, "aim" | "kind">): Aim {
  if (isAim(p.aim)) return p.aim;
  return p.kind === "tool" ? "useful" : "demand";
}

// ねらいの基準（ねらいごとの値がなければ、一括の値）
export function aimBasis(aim: Aim, s: JudgeSettings): { visits: number; days: number; own: boolean } {
  const k = AIM_JUDGE_KEYS[aim];
  const v = Number(s[k.visits]) || 0;
  const d = Number(s[k.days]) || 0;
  return { visits: v > 0 ? v : s.judgeMinVisits, days: d > 0 ? d : s.judgeAfterDays, own: v > 0 || d > 0 };
}

export type JudgeBasis = { aim: Aim; visits: number; days: number; base: { visits: number; days: number }; adjusted: boolean; reason: string | null };

// その案件の判断の基準（公開の前に決めた案件ごとの調整があれば、それを使う）
export function judgeBasis(p: Pick<ProjectRow, "aim" | "kind" | "judge_visits" | "judge_days" | "judge_reason">, s: JudgeSettings): JudgeBasis {
  const aim = judgeAim(p);
  const base = aimBasis(aim, s);
  const visits = p.judge_visits && p.judge_visits > 0 ? p.judge_visits : base.visits;
  const days = p.judge_days && p.judge_days > 0 ? p.judge_days : base.days;
  // 調整したかは、案件の値が残っているかで決める（あとでねらいの基準と同じ値になっても、案件の値が効いていると分かるように。PR #209 の ai-review の指摘）
  const own = (p.judge_visits ?? 0) > 0 || (p.judge_days ?? 0) > 0;
  return { aim, visits, days, base: { visits: base.visits, days: base.days }, adjusted: own, reason: p.judge_reason ?? null };
}

// アイデアを案件にするときの、AIの案件ごとの調整（ねらいの基準の半分〜1.5倍。範囲の外は端に寄せる。理由がなければ調整しない）
export function parseJudgeAdjust(raw: unknown, base: { visits: number; days: number }): { visits: number; days: number; reason: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const reason = typeof o.why === "string" ? o.why.trim().slice(0, 200) : "";
  if (!reason) return null;
  const fit = (v: unknown, b: number, min: number) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n <= 0) return b;
    // 幅は、下限を切り上げ・上限を切り捨てで求める（7日の1.5倍の10.5日を11日にしない。PR #209 の ai-review の指摘）
    return Math.max(min, Math.min(Math.floor(b * ADJUST_RANGE.max), Math.max(Math.ceil(b * ADJUST_RANGE.min), n)));
  };
  const visits = fit(o.visits, base.visits, 1);
  const days = fit(o.days, base.days, 1);
  if (visits === base.visits && days === base.days) return null;
  return { visits, days, reason };
}

// 今の流入で育てられる案件の数の計算に使う基準（「広がる」は自分の投稿で広がるかを見るので除き、ねらいの配分で重みを付ける）
export function capacityBasis(s: JudgeSettings & Pick<Settings, "aimSpread" | "aimUseful" | "aimReturn" | "aimDemand">): { visits: number; days: number } {
  const w = aimWeightsOf(s);
  const aims = AIM_KEYS.filter((a) => a !== "spread");
  const total = aims.reduce((n, a) => n + w[a], 0);
  if (!total) return { visits: s.judgeMinVisits, days: s.judgeAfterDays };
  const avg = (f: (a: Aim) => number) => Math.round(aims.reduce((n, a) => n + f(a) * w[a], 0) / total);
  return { visits: avg((a) => aimBasis(a, s).visits), days: avg((a) => aimBasis(a, s).days) };
}

// AIへの指示・材料に使う、ねらいごとの基準の一覧
export function aimJudgeLine(s: JudgeSettings): string {
  return AIM_KEYS.map((a) => {
    const b = aimBasis(a, s);
    return `${AIMS[a].label} 訪問${b.visits}人か${b.days}日`;
  }).join(" / ");
}
