import { callJson, isObj, isStr } from "./ai";
import { db, getSettings } from "./db";
import { logEvent } from "./loop";
import { modelInfo } from "./models";
import { NIGHTLY_HOUR, maybeDailyDigest } from "./notify";
import { BOTTLENECK_LABEL, TASK_KIND_LABEL, planFor, planProgress } from "./plan";
import { jstDay } from "./sns";

// 日報: 毎晩（その日の投稿が終わる22時以降）、朝会の担当AIが1日の結果を書く。朝の計画と違い「実際にどうだったか」の記録
// 運営者の note に貼る下書きと画像も作っていたが、運営者が「中身の話ができない」として不要と決めたので作らない（列は空で入れる）

export type DiaryContent = {
  headline: string;
  did: string[];
  learned: string[];
  failed: string[];
  tomorrow: string;
  numbers: { done: number; total: number; visits: number; conversions: number; predictedVisits: number | null; predictedConversions: number | null; bottleneck: string };
};
export type DiaryImage = { file: string; label: string };
export type DiaryRow = { id: number; day: string; created_at: string; model_id: string; content: string; note_title: string; note_body: string; images: string };

export function listDiaries(limit = 60): DiaryRow[] {
  return db().prepare("SELECT * FROM daily_reports ORDER BY day DESC LIMIT ?").all(limit) as DiaryRow[];
}

export async function createDiary({ force = false } = {}): Promise<number> {
  const day = jstDay();
  const existing = db().prepare("SELECT id FROM daily_reports WHERE day = ?").get(day) as { id: number } | undefined;
  if (existing && !force) return existing.id;
  const plan = planFor(day);
  if (!plan) throw new Error("今日の計画がないため、日報を書けません");
  const g = planProgress(plan);
  const bottleneck = BOTTLENECK_LABEL[g.content.bottleneck].split("（")[0];
  const q = (sql: string) => db().prepare(sql).all(day) as Record<string, string>[];
  const events = q("SELECT message FROM events WHERE date(at, '+9 hours') = ? AND actor != 'human' AND kind NOT LIKE '%error%' AND kind NOT IN ('sns-draft', 'plan-task', 'backup') ORDER BY id DESC LIMIT 40");
  const voices = q("SELECT scene, text FROM voices WHERE date(at, '+9 hours') = ? ORDER BY id DESC LIMIT 12");
  const outside = q("SELECT source, choice, text FROM external_voices WHERE date(at, '+9 hours') = ? ORDER BY id DESC LIMIT 12");
  const research = q("SELECT question, status, summary FROM research WHERE date(at, '+9 hours') = ? ORDER BY id DESC LIMIT 3");
  const effects = q("SELECT scene, change FROM voice_effects WHERE date(at, '+9 hours') = ? ORDER BY id DESC LIMIT 6");
  const out = await callJson<Omit<DiaryContent, "numbers">>({
    purpose: "日報",
    modelId: plan.model_id,
    system: `あなたは「AIを社員にした、小さなプロダクト会社の実験」の、今日の朝会の担当です。1日の終わりに、朝の計画に対して実際にどうだったかを日報に書きます。日報は誰でも読めるページに載ります。
- headline: 今日を1文で（40文字以内。カードの画像の見出しになる）
- did: 実際にやったこと（2〜4件。予定だけで実行していないものは書かない）
- learned: 分かったこと（0〜3件。件数が少ないときは「まだ偶然の可能性が高い」と添える）
- failed: 効かなかった・できなかったこと（0〜3件。隠さない）
- tomorrow: 明日どう変えるか（1〜2文）
守ること: 数字と出来事は材料にあるものだけを使う。利用者が書いた文はそのまま引用せず要約する。作り話をしない
形式: {"headline":"","did":[""],"learned":[""],"failed":[""],"tomorrow":""}`,
    user: `今日: ${day}
朝の方針: ${g.content.focus}（今のネック: ${bottleneck}）
予定: ${g.done}/${g.total}件 済み（失敗${g.failed}・見送り${g.skipped}・承認待ち${g.held}）
${g.tasks.map((t) => `- ${t.at_time} ${TASK_KIND_LABEL[t.kind]}${t.platform ? `(${t.platform})` : ""}「${(t.angle ?? "").slice(0, 60)}」→ ${t.status}`).join("\n")}
目標と実測: ${g.goals.map((x) => `${x.metric} ${x.actual}/${x.target}`).join("・") || "なし"}
朝の予想: ${g.prediction ? `訪問${g.prediction.visits}人・登録/利用${g.prediction.conversions}人 → 実測 訪問${g.actual.visits}人・登録/利用${g.actual.conversions}人` : "なし"}

今日の出来事:
${events.map((e) => `- ${e.message.slice(0, 140)}`).join("\n") || "（なし）"}

外の声（実際の人の反応）:
${outside.map((v) => `- ${v.source} ${v.choice ?? ""} ${v.text.slice(0, 100)}`).join("\n") || "（なし）"}

調べたこと:
${research.map((r) => `- ${r.question} → ${r.status}: ${(r.summary ?? "").slice(0, 200)}`).join("\n") || "（なし）"}

外の声・調べたことで変えた判断:
${effects.map((e) => `- ${e.scene}: ${e.change}`).join("\n") || "（なし）"}

社員のひとこと:
${voices.map((v) => `- ${v.scene}: ${v.text}`).join("\n") || "（なし）"}`,
    validate: (v): v is Omit<DiaryContent, "numbers"> => isObj(v) && isStr(v.headline) && Array.isArray(v.did),
  });
  const list = (x: unknown) => (Array.isArray(x) ? x.filter(isStr).slice(0, 4).map((t) => t.slice(0, 200)) : []);
  const content: DiaryContent = {
    headline: out.headline.slice(0, 60), did: list(out.did), learned: list(out.learned), failed: list(out.failed), tomorrow: String(out.tomorrow ?? "").slice(0, 300),
    numbers: { done: g.done, total: g.total, visits: g.actual.visits, conversions: g.actual.conversions, predictedVisits: g.prediction?.visits ?? null, predictedConversions: g.prediction?.conversions ?? null, bottleneck },
  };
  const label = modelInfo(plan.model_id).label;
  db().prepare(
    `INSERT INTO daily_reports (day, model_id, content, note_title, note_body, images) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET model_id = excluded.model_id, content = excluded.content, note_title = excluded.note_title, note_body = excluded.note_body, images = excluded.images, created_at = datetime('now')`,
  ).run(day, plan.model_id, JSON.stringify(content), "", "", "[]");
  logEvent(null, "ai", "daily-report", `今日の日報を書きました（担当 ${label}）: ${content.headline}`);
  return (db().prepare("SELECT id FROM daily_reports WHERE day = ?").get(day) as { id: number }).id;
}

// 毎晩、投稿の時間が終わる22時以降に1回: 日報を書いて、そのまま1日のまとめとして Discord に送る
export async function maybeNightlyReport() {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  if (hour < NIGHTLY_HOUR) return;
  await writeDiaryIfDue();
  try {
    await maybeDailyDigest();
  } catch (e) {
    logEvent(null, "system", "notify-error", `1日のまとめを送れませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  }
}

async function writeDiaryIfDue() {
  const s = getSettings();
  const day = jstDay();
  if (!s.dailyReport || s.killSwitch || !planFor(day) || db().prepare("SELECT 1 FROM daily_reports WHERE day = ?").get(day)) return;
  // 失敗した直後は、1時間あけてから試す
  if (db().prepare("SELECT 1 FROM events WHERE kind = 'diary-error' AND at >= datetime('now', '-1 hours')").get()) return;
  try {
    await createDiary();
  } catch (e) {
    logEvent(null, "system", "diary-error", `今日の日報を書けませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  }
}
