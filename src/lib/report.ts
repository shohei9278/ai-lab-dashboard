import { callJson, isObj, isStr } from "./ai";
import { db, getSettings, saveSettings, type ProjectRow } from "./db";
import { CONV, KIND_LABEL, STAGE_LABEL, ideaAuthorStats, logEvent } from "./loop";
import { modelInfo } from "./models";
import { costEfficiency } from "./cost";
import { headline, endReasons, rankings } from "./experiment";
import { jstDateTime } from "./format";

// 週ごとのレポート: 1週間の数字と動きをAIがまとめ、発信用の下書き（Xの投稿・記事）と、実験メモの追加案も作る

export type Report = {
  summary: string; // 3行ほどのまとめ
  numbers: { label: string; value: string }[];
  highlights: string[]; // 今週あったこと
  noteIdeas: { title: string; body: string; topic: string }[]; // 実験メモに足すとよい気づき
  xPosts: string[]; // あなたの個人アカウントで投稿する「実験ログ」の下書き
  article: string; // note などに載せる記事の下書き（Markdown）
  next: string[]; // 来週やるとよいこと
};
export type ReportRow = { id: number; created_at: string; period_start: string; period_end: string; model_id: string; content: string };

const isReport = (v: unknown): v is Report =>
  isObj(v) && isStr(v.summary) && isStr(v.article) && Array.isArray(v.numbers) && Array.isArray(v.highlights) &&
  Array.isArray(v.noteIdeas) && Array.isArray(v.xPosts) && Array.isArray(v.next);

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// AIに渡す材料（デモは除く）
function gather(start: string) {
  const s = getSettings();
  const since = `${start} 00:00:00`;
  const projects = db().prepare("SELECT * FROM projects WHERE demo = 0").all() as ProjectRow[];
  const pid = new Set(projects.map((p) => p.id));
  const events = (db().prepare("SELECT e.at, e.actor, e.message, e.project_id FROM events e WHERE e.at >= ? ORDER BY e.id").all(since) as { at: string; actor: string; message: string; project_id: number | null }[])
    .filter((e) => e.project_id === null || pid.has(e.project_id));
  const lines = projects.map((p) => {
    const m = db().prepare("SELECT COALESCE(SUM(visits),0) AS v, COALESCE(SUM(signups),0) AS c, COALESCE(SUM(shares),0) AS sh, COALESCE(SUM(ad_spend_jpy),0) AS ad FROM metrics WHERE project_id = ? AND day >= ?").get(p.id, start) as { v: number; c: number; sh: number; ad: number };
    const all = db().prepare("SELECT COALESCE(SUM(visits),0) AS v, COALESCE(SUM(signups),0) AS c FROM metrics WHERE project_id = ?").get(p.id) as { v: number; c: number };
    return `- #${p.id} ${p.title}（${KIND_LABEL[p.kind]}・${STAGE_LABEL[p.stage]}・アイデア: ${modelInfo(p.idea_model ?? p.model_id).label}）今週: 訪問${m.v} ${CONV[p.kind].noun}${m.c}${p.kind === "tool" ? ` シェア${m.sh}` : ""} 広告費${m.ad}円 / 累計: 訪問${all.v} ${CONV[p.kind].noun}${all.c}`;
  });
  const cost = db().prepare("SELECT purpose, COUNT(*) AS n, SUM(cost_usd) AS usd FROM ai_calls WHERE at >= ? GROUP BY purpose ORDER BY usd DESC").all(since) as { purpose: string; n: number; usd: number }[];
  const notes = db().prepare("SELECT title, certainty FROM notes WHERE at >= ?").all(since) as { title: string; certainty: string }[];
  const posts = db().prepare("SELECT s.text, s.visits, s.conversions, p.title FROM sns_posts s JOIN projects p ON p.id = s.project_id WHERE s.posted_at >= ?").all(since) as { text: string; visits: number; conversions: number; title: string }[];
  const authors = ideaAuthorStats().map((a) => `- ${modelInfo(a.author).label}: 候補${a.candidates} 選ばれた${a.selected} 他社からの点${a.scoreFromOthers?.toFixed(1) ?? "-"} 自分の案への点${a.scoreFromSelf?.toFixed(1) ?? "-"}`);
  const ce = costEfficiency().all;
  const h = headline();
  const ends = endReasons();
  const tops = rankings().filter((r) => r.rows.length > 1).map((r) => `- ${r.title}: 1位 ${r.rows[0].label}（${r.rows[0].display}）`);
  return [
    `実験の累計: AIが作った案件 ${h.projects}件・公開 ${h.published}件・育てる段階 ${h.continued}件・撤退 ${h.killed}件 / AIだけで公開 ${h.auto.published}件（人が確認 ${h.auto.reviewed}件・ダメ ${h.auto.bad}件）/ 人が操作した回数 ${h.humanActs}回 / AIの費用の累計 ${Math.round(h.aiJpy)}円`,
    `撤退した理由の内訳: ${ends.map((e) => `${e.label} ${e.n}件`).join("・") || "まだなし"}`,
    `AIのランキング（部門ごとの1位）:\n${tops.join("\n") || "（まだ比べられない）"}`,
    `期間: ${start} から今日まで`,
    `案件（実案件のみ）:\n${lines.join("\n") || "（なし）"}`,
    `今週の出来事:\n${events.map((e) => `- ${jstDateTime(e.at)} [${e.actor}] ${e.message}`).join("\n").slice(0, 6000) || "（なし）"}`,
    `今週のAI費用（目的別）:\n${cost.map((c) => `- ${c.purpose}: ${c.n}回・${Math.round(c.usd * s.usdJpy)}円`).join("\n") || "（なし）"}`,
    `成果1件あたりの費用（累計）: ${ce.perConversion === null ? "成果なし" : `${Math.round(ce.perConversion)}円`}（AI ${Math.round(ce.aiJpy)}円＋広告 ${Math.round(ce.adJpy)}円、成果 ${ce.conversions}件）`,
    `アイデア出しのAI別の成績（累計）:\n${authors.join("\n") || "（なし）"}`,
    `今週のSNS投稿:\n${posts.map((x) => `- ${x.title}: 「${x.text.slice(0, 50)}…」訪問${x.visits} 成果${x.conversions}`).join("\n") || "（なし）"}`,
    `今週書かれた実験メモ:\n${notes.map((n) => `- ${n.title}（${n.certainty}）`).join("\n") || "（なし）"}`,
  ].join("\n\n");
}

export async function createReport(): Promise<number> {
  const s = getSettings();
  const end = new Date();
  const startDate = new Date(end.getTime() - 7 * 86_400_000);
  const material = gather(day(startDate));
  const r = await callJson<Report>({
    purpose: "週のレポート",
    system: `あなたは「AIが自動でプロダクトを作る実験」の記録係です。1週間の材料から、運営者向けのレポートと、外に発信するための下書きを作ります。
守ること:
- 材料にある数字だけを使い、推測で数字を作らない。件数が少ないときは「まだ偶然の可能性が高い」とはっきり書く
- 盛らない。うまくいかなかったことも正直に書く（失敗も実験の成果）
- 記事やXの下書きでは、サービス名は出してよいが、URLは書かない（載せるかは運営者が決める）
- 記事（article）は note に載せる想定の Markdown。見出し・箇条書きを使い、800〜1500文字。「AIに何を任せ、人は何を判断したか」「数字」「気づき」「来週」の流れにする
- xPosts は、運営者が自分の個人アカウントで投稿する「実験ログ」。日本語で1件120文字以内を2〜3件。一人称で「AIにプロダクト作りを丸ごと任せる実験をしている人」として、今週AIが作ったもの・撤退したもの・数字・意外だったことを書く。1件目は「今週の実験ログ」として数字の要約、2件目以降は気づきを1つずつ。サービスの宣伝にはしない
- noteIdeas は、実験メモに残す価値がある気づき（数字の根拠つき）を0〜3件。topic は idea / design / tool / judge / cost / other のどれか
形式: {"summary":"3行ほどのまとめ","numbers":[{"label":"項目","value":"値"}],"highlights":["今週あったこと"],"noteIdeas":[{"title":"気づき","body":"根拠","topic":"idea"}],"xPosts":["投稿"],"article":"記事のMarkdown","next":["来週やるとよいこと"]}`,
    user: material,
    validate: isReport,
  });
  const id = Number(
    db().prepare("INSERT INTO reports (period_start, period_end, model_id, content) VALUES (?, ?, ?, ?)")
      .run(day(startDate), day(end), s.loopModel, JSON.stringify(r)).lastInsertRowid,
  );
  saveSettings({ lastWeeklyReport: day(end) });
  logEvent(null, "ai", "report", `週のレポートを作成しました（${day(startDate)}〜${day(end)}）`);
  return id;
}

export function listReports(): ReportRow[] {
  return db().prepare("SELECT * FROM reports ORDER BY id DESC").all() as ReportRow[];
}

// 毎週月曜（設定の時刻以降）に1回だけ作る
export async function maybeWeeklyReport() {
  const s = getSettings();
  const now = new Date();
  if (!s.weeklyReport || s.killSwitch || now.getDay() !== 1 || now.getHours() < s.dailyHour || s.lastWeeklyReport === day(now)) return;
  await createReport();
  // 集客の作戦も、前の週の結果をふまえて作り直す（公開中の案件がないときは何もしない）
  try {
    const { createGrowthPlan } = await import("./growth");
    await createGrowthPlan({ followers: null, wish: "" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/公開中の案件がありません/.test(msg)) logEvent(null, "system", "growth-error", `集客の作戦の作り直しでエラー: ${msg}`.slice(0, 500));
  }
}
