import { getSettings, monthSpendUsd, saveSettings } from "./db";
import { publishingConfigured, sb } from "./publish";

// 公開サイトのツールが、その場で AI を呼ぶときの「止める」と「予算」を、ダッシュボードから伝える（docs/design-tool-limits.md の ③）
// - 公開サイトのサーバー（/api/tool-ai）は、Supabase の tool_ai_settings が enabled かつ budget_ok のときだけ、AI を呼ぶ前の額を取れる
// - enabled: 止めるスイッチ（killSwitch）が切れている。budget_ok: 今月のAI費用（公開サイトの分も含む）が月の予算に届いていない
// - 公開サイトで今月使った額を取り込み、月の予算に数える（monthSpendBreakdownUsd の site）
// スケジューラーの5分ごとと、設定を保存したとき（止めるスイッチをすぐ伝えるため）に呼ぶ。Supabase の表・関数がまだなければ何もしない
export async function syncToolAiSettings(): Promise<void> {
  if (!publishingConfigured()) return;
  const spent = await sb().rpc("tool_ai_month_spent");
  if (spent.error) throw new Error(`今月の額を読めませんでした: ${spent.error.message}`);
  const jpy = Number(spent.data);
  if (Number.isFinite(jpy) && jpy >= 0 && jpy !== getSettings().toolAiMonthJpy) saveSettings({ toolAiMonthJpy: Math.round(jpy * 100) / 100 });
  const s = getSettings();
  const { error } = await sb().from("tool_ai_settings").upsert({
    id: 1,
    enabled: !s.killSwitch,
    budget_ok: monthSpendUsd() * s.usdJpy < s.monthlyBudgetJpy,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`止めるスイッチ・予算を伝えられませんでした: ${error.message}`);
}
