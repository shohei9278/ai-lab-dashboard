import { budgetState } from "./budget";
import { getSettings, saveSettings, type Settings } from "./db";
import { logEvent } from "./loop";

// 予算の自動運転: 月のAI予算の使い方のペースに合わせて、費用のかかる設定を自動で絞る（運営者が決めた）
// - 人が決めるのは、月の予算・緊急停止と、設定の値（ここで絞るときの上限）だけ。自動運転は、人が決めた値より増やさない
// - 新しく作る案件の数は、もともと budget.ts が予算のペースで決めている。ここでは、それ以外の費用のかかるもの（アイデアの数・イラスト・動画・じっくり案件・「広がる」の数）を絞る
// - 月の上限そのものと緊急停止は、ここでは変えない（超えたら、ai.ts がAIの呼び出しを止める）

export type AutopilotLevel = "normal" | "careful" | "saving";
export const AUTOPILOT_LABEL: Record<AutopilotLevel, string> = { normal: "ふつう", careful: "控えめ", saving: "節約" };
const CAREFUL_PACE = 1.0; // 月末の見込みが予算を超えそうなら「控えめ」
const SAVING_PACE = 1.2; // 予算の2割以上超えそうなら「節約」
const MIN_DAYS = 3; // 月の初めの数日は、見込みがぶれやすいので「ふつう」のまま（予算の創作の分を使い切ったときは除く）

export function autopilotLevel(b = budgetState(), day = new Date().getDate()): { level: AutopilotLevel; pace: number } {
  const pace = b.budget > 0 ? b.projected / b.budget : 0;
  if (!b.creativeOk) return { level: "saving", pace };
  if (day < MIN_DAYS) return { level: "normal", pace };
  return { level: pace > SAVING_PACE ? "saving" : pace > CAREFUL_PACE ? "careful" : "normal", pace };
}

// 段階に合わせて、費用のかかる設定を絞った値（人が決めた値より増やさない）
export function applyAutopilot(s: Settings, level: AutopilotLevel): Settings {
  if (!s.budgetAutopilot || level === "normal") return s;
  if (level === "careful") {
    return { ...s, dailyIdeaCount: Math.max(1, Math.ceil(s.dailyIdeaCount / 2)), playVideoOnPublish: false, deepPerWeek: Math.min(s.deepPerWeek, 1) };
  }
  return { ...s, dailyIdeaCount: 1, spreadPerDay: Math.min(s.spreadPerDay, 1), illustrations: false, playVideoOnPublish: false, deepPerWeek: 0 };
}

// 費用のかかる設定を読む所は、getSettings の代わりにこれを使う（設定の画面には、人が決めた値をそのまま出す）
export function autoSettings(): Settings {
  const s = getSettings();
  return s.budgetAutopilot ? applyAutopilot(s, autopilotLevel().level) : s;
}

// 段階が変わったら記録して知らせる（定期の処理から呼ぶ）
export function autopilotTick(): void {
  const s = getSettings();
  const b = budgetState();
  const { level, pace } = s.budgetAutopilot ? autopilotLevel(b) : { level: "normal" as const, pace: 0 };
  const before = (Object.hasOwn(AUTOPILOT_LABEL, s.autopilotLevel) ? s.autopilotLevel : "normal") as AutopilotLevel;
  if (level === before) return;
  saveSettings({ autopilotLevel: level });
  const what = level === "normal" ? "人が決めた設定の値に戻しました"
    : level === "careful" ? "アイデアの数を半分に、じっくり案件を週1件までにし、公開のときの動画を止めました"
    : "アイデアの数を1社1件に、「広がる」を1日1件までにし、イラスト・公開のときの動画・じっくり案件を止めました";
  logEvent(null, "system", "autopilot",
    `予算の自動運転: 「${AUTOPILOT_LABEL[before]}」から「${AUTOPILOT_LABEL[level]}」にしました（${s.budgetAutopilot ? `月末の見込み 約${Math.round(b.projected).toLocaleString("ja-JP")}円・予算 ${b.budget.toLocaleString("ja-JP")}円・${Math.round(pace * 100)}%` : "自動運転をオフにしたため"}）。${what}`);
}
