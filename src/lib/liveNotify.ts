import { getSettings } from "./db";
import { notifyConfigured, sendNotify } from "./notify";

// その場の通知: AIが何かを始めたとき・終えたときに、Discord（NOTIFY_WEBHOOK_URL）へ送る（1日のまとめとは別）
// - 処理の記録（logEvent）から、種類ごとに選んで送る。始めるときの通知は、それぞれの処理から notifyStart で送る
// - 短い間に続いた通知は、まとめて1回で送る（Discord の回数の制限に当たらないように）
// - 同じ種類のエラーは、1時間に1回まで

import { NOTIFY_KINDS } from "./notifyKinds";
export { NOTIFY_KINDS };
export type NotifyKind = keyof typeof NOTIFY_KINDS;

const ICON: Record<NotifyKind, string> = { start: "▶️", plan: "🗓️", post: "📣", build: "🛠️", decision: "⚖️", human: "🙋", outside: "👂", meeting: "💬", error: "⚠️" };

// 処理の記録の種類 → 通知の種類（ここにないものは送らない）
const EVENT_KIND: Record<string, NotifyKind> = {
  plan: "plan", "plan-task": "plan", "plan-cap": "plan", "daily-report": "plan",
  "sns-post": "post",
  select: "build", publish: "build", "auto-publish": "build", "auto-improve": "build", close: "build", revert: "build", hold: "build", resume: "build",
  judge: "decision", "auto-decision": "decision", grow: "decision", "auto-blocked": "decision",
  "outside-voice": "outside", research: "outside", "voice-effect": "outside",
  meeting: "meeting", proposal: "meeting",
};

const g = globalThis as unknown as { __aiLabNotifyQueue?: string[]; __aiLabNotifyTimer?: NodeJS.Timeout; __aiLabNotifyErr?: Map<string, number> };
const queue = (g.__aiLabNotifyQueue ??= []);
const lastErr = (g.__aiLabNotifyErr ??= new Map());

function enabled(kind: NotifyKind): boolean {
  if (!notifyConfigured()) return false;
  const s = getSettings();
  return s.notifyLive && !s.notifyOff.split(",").map((x) => x.trim()).includes(kind);
}

function push(kind: NotifyKind, text: string) {
  queue.push(`${ICON[kind]} ${text.replace(/\n+/g, " ").slice(0, 300)}`);
  if (g.__aiLabNotifyTimer) return;
  // 5秒待って、そのあいだに続いた通知と一緒に送る
  g.__aiLabNotifyTimer = setTimeout(() => {
    g.__aiLabNotifyTimer = undefined;
    const lines = queue.splice(0);
    if (lines.length) sendNotify(lines.join("\n")).catch((e) => console.error("その場の通知を送れませんでした", e));
  }, 5000);
}

// 処理の記録から呼ぶ（loop.ts の logEvent）
export function notifyEvent(kind: string, actor: string, message: string) {
  try {
    let k: NotifyKind | undefined = EVENT_KIND[kind];
    if (kind.endsWith("-error")) {
      if (kind === "notify-error") return;
      const last = lastErr.get(kind) ?? 0;
      if (Date.now() - last < 3_600_000) return;
      lastErr.set(kind, Date.now());
      k = "error";
    }
    if (!k || !enabled(k)) return;
    // 投稿が済んだ予定は、投稿の通知（URL付き）と重なるので送らない
    if (kind === "plan-task" && /投稿/.test(message) && /: 済み$/.test(message)) return;
    // 人が自分で操作したことは、本人に知らせなくてよい
    if (actor === "human") return;
    push(k, message);
  } catch {
    // 通知の失敗で、本来の処理を止めない
  }
}

// 始めるときに、それぞれの処理から呼ぶ
export function notifyStart(text: string) {
  try {
    if (enabled("start")) push("start", text);
  } catch {
    // 通知の失敗で、本来の処理を止めない
  }
}

// あなたの確認・判断が必要になったとき（承認待ちを作ったとき）
export function notifyHuman(text: string) {
  try {
    if (enabled("human")) push("human", text);
  } catch {
    // 通知の失敗で、本来の処理を止めない
  }
}
