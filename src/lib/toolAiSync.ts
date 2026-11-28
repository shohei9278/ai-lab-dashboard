import { getSettings, jstMonth, monthSpendUsd, saveSettings } from "./db";
import { publishingConfigured, sb } from "./publish";

// 公開サイトのツールが、その場で AI を呼ぶときの「止める」と「予算」を、ダッシュボードから伝える（docs/design-tool-limits.md の ③）
// - 公開サイトのサーバー（/api/tool-ai）は、Supabase の tool_ai_settings が enabled かつ budget_ok のときだけ、AI を呼ぶ前の額を取れる
// - enabled: 止めるスイッチ（killSwitch）が切れている。budget_ok: 今月のAI費用（公開サイトの分も含む）が月の予算に届いていない
// - 公開サイトで今月使った額を取り込み、月の予算に数える（monthSpendBreakdownUsd の site。どの月の分かも一緒に持つ）

// 止めるスイッチと予算の印だけを書く（今月の額を読めなくても書けるよう、分けておく。PR #241 の ai-review の指摘）
export async function pushToolAiFlags(): Promise<void> {
  if (!publishingConfigured()) return;
  const s = getSettings();
  const { error } = await sb().from("tool_ai_settings").upsert({
    id: 1,
    enabled: !s.killSwitch,
    budget_ok: monthSpendUsd() * s.usdJpy < s.monthlyBudgetJpy,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`止めるスイッチ・予算を伝えられませんでした: ${error.message}`);
}

// スケジューラーの5分ごとに呼ぶ。先に印を書き（止めるスイッチを、ほかの失敗に巻き込まない）、今月の額を取り込んでから、予算の印を書き直す
// Supabase の表・関数がまだなければ失敗する（呼んだ側で1回だけ記録する）
export async function syncToolAiSettings(): Promise<void> {
  if (!publishingConfigured()) return;
  await pushToolAiFlags();
  const spent = await sb().rpc("tool_ai_month_spent");
  if (spent.error) throw new Error(`今月の額を読めませんでした: ${spent.error.message}`);
  const jpy = Number(spent.data);
  if (!Number.isFinite(jpy) || jpy < 0) throw new Error("今月の額の形が違います");
  const s = getSettings();
  const month = jstMonth();
  const rounded = Math.round(jpy * 100) / 100;
  if (rounded === s.toolAiMonthJpy && month === s.toolAiMonth) return;
  saveSettings({ toolAiMonthJpy: rounded, toolAiMonth: month });
  await pushToolAiFlags();
}
