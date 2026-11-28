import { callJson, isObj, isStr } from "./ai";
import { db, getSettings, saveSettings, type ProjectRow } from "./db";
import { CONV, KIND_LABEL, STAGE_LABEL, ideaAuthorStats, logEvent } from "./loop";
import { modelInfo } from "./models";
import { costEfficiency } from "./cost";
import { NOTE_TOPICS, addNote, type NoteTopic } from "./notes";
import { headline, endReasons, rankings } from "./experiment";
import { jstDateTime } from "./format";
import { BOTTLENECK_LABEL, GOAL_LABEL, planProgress, recentPlans } from "./plan";

// 週のまとめ: 1週間の数字と動きをAIがまとめ、実験メモに残すとよい気づきも出す（気づきは、社内の知見に自動で入れる）
// 11/28 に運営者が、発信用の下書き（運営者の個人の X の「実験ログ」・note の記事）はやめると決めた（note の記事は記事のルーティンが書くため）

export type Report = {
  summary: string; // 3行ほどのまとめ
  numbers: { label: string; value: string }[];
  highlights: string[]; // 今週あったこと
  noteIdeas: { title: string; body: string; topic: string }[]; // 実験メモに足すとよい気づき（作ったときに、社内の知見に自動で入れる）
  xPosts?: string[]; // 11/28 までのまとめだけにある「実験ログ」の下書き（いまは作らない・出さない）
  article?: string; // 11/28 までのまとめだけにある note の記事の下書き（いまは作らない・出さない）
  next: string[]; // 来週やるとよいこと
};
export type ReportRow = { id: number; created_at: string; period_start: string; period_end: string; model_id: string; content: string };

const isReport = (v: unknown): v is Report =>
  isObj(v) && isStr(v.summary) && Array.isArray(v.numbers) && Array.isArray(v.highlights) &&
  Array.isArray(v.noteIdeas) && Array.isArray(v.next);

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// AIに渡す材料（デモは除く）
// 日本時間の日付（YYYY-MM-DD）の0時を、記録の日時（UTC の "YYYY-MM-DD HH:MM:SS"）にする
// 記録は UTC で残しているので、日本時間の日付にそのまま 00:00:00 を付けると、日本時間の0時〜9時の記録が抜けていた（PR #126 の ai-review の指摘）
export const jstStartUtc = (day: string) => new Date(`${day}T00:00:00+09:00`).toISOString().slice(0, 19).replace("T", " ");

export function gather(start: string) {
  const s = getSettings();
  const since = jstStartUtc(start);
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
    `毎日の計画（AIが毎朝決めたネックと、予定・目標の達成）:\n${recentPlans(7).map((pl) => { const g = planProgress(pl); return `- ${pl.day}: ${BOTTLENECK_LABEL[g.content.bottleneck].split("（")[0]}・${g.content.focus}・予定 ${g.done}/${g.total}件・目標 ${g.goals.map((x) => `${GOAL_LABEL[x.metric]} ${x.actual}/${x.target}`).join("・")}`; }).join("\n") || "（なし）"}`,
    `今週書かれた実験メモ:\n${notes.map((n) => `- ${n.title}（${n.certainty}）`).join("\n") || "（なし）"}`,
  ].join("\n\n");
}

// 定例会議から呼ぶ: extra（会議の振り返りと採用した提案）も材料に入れ、議長のAIがまとめる。next には採用した提案を入れる
export async function createReport(opts: { extra?: string; modelId?: string; next?: string[] } = {}): Promise<number> {
  const s = getSettings();
  const end = new Date();
  const startDate = new Date(end.getTime() - 7 * 86_400_000);
  const material = gather(day(startDate)) + (opts.extra ?? "");
  const out = await callJson<Report>({
    purpose: "週のレポート",
    modelId: opts.modelId,
    system: `あなたは「AIが自動でプロダクトを作る実験」の記録係です。1週間の材料から、運営者向けの週のまとめを作ります。
守ること:
- 材料にある数字だけを使い、推測で数字を作らない。件数が少ないときは「まだ偶然の可能性が高い」とはっきり書く
- 盛らない。うまくいかなかったことも正直に書く（失敗も実験の成果）
- noteIdeas は、実験メモに残す価値がある気づき（数字の根拠つき）を0〜3件。topic は idea / design / tool / judge / cost / other のどれか
形式: {"summary":"3行ほどのまとめ","numbers":[{"label":"項目","value":"値"}],"highlights":["今週あったこと"],"noteIdeas":[{"title":"気づき","body":"根拠","topic":"idea"}],"next":["来週やるとよいこと"]}`,
    user: material,
    validate: isReport,
  });
  // 保存するのは、まとめ・数字・今週あったこと・気づき・採用した提案だけ（AIが頼んでいない下書き（article・xPosts）を返しても残さない。
  // 残すと、画面が前の形のまとめと見なして、追加のボタンを出してしまう。PR #237 の ai-review の指摘）
  // 気づきは、形の正しいものだけを残す（題が文字でないものなどを保存すると、画面で読めない。PR #237 の ai-review の指摘）
  const saved = toSaved(out, opts.next);
  // まとめの保存・気づきの追加・最後に作った日の更新を、1つのトランザクションにする（途中で失敗して、まとめだけ・気づきの一部だけが残らないように。PR #237 の ai-review の指摘）
  const { id, added } = db().transaction(() => {
    const newId = Number(
      db().prepare("INSERT INTO reports (period_start, period_end, model_id, content) VALUES (?, ?, ?, ?)")
        .run(day(startDate), day(end), opts.modelId ?? s.loopModel, JSON.stringify(saved)).lastInsertRowid,
    );
    const n = addNoteIdeas(saved.noteIdeas);
    saveSettings({ lastWeeklyReport: day(end) });
    return { id: newId, added: n };
  })();
  logEvent(null, "ai", "report", `週のまとめを作成しました（${day(startDate)}〜${day(end)}）。実験メモに気づきを${added}件入れました`);
  return id;
}

export function listReports(): ReportRow[] {
  return db().prepare("SELECT * FROM reports ORDER BY id DESC").all() as ReportRow[];
}


// 週のまとめの「実験メモに残すとよい気づき」を、社内の知見（実験メモ）に入れる（11/28 に運営者が、手で足すのではなく自動でよいと決めた）
// 前の「足す」ボタンと同じく、書いた人は AI・確かさは「1回見ただけ」・公開しない。同じ題の実験メモがすでにあれば入れない。入れた数を返す
export function addNoteIdeas(ideas: unknown): number {
  let n = 0;
  for (const x of cleanNoteIdeas(ideas)) {
    // 根拠のない気づきは入れない（toSaved と同じ。直接呼ばれたときも守る）
    if (!x.body || noteTitled(x.title)) continue;
    addNote({ author: "ai", topic: noteTopicOf(x.topic), certainty: "once", title: x.title, body: x.body, projectId: null, isPublic: false });
    n++;
  }
  return n;
}

// 週のまとめとして保存する形（AIの答えから、決まった項目だけを取り出す）
// 気づきは、根拠のあるものだけを、頼んだ上限（NOTE_IDEAS_MAX 件）まで残す（根拠のない題だけの気づきを実験メモに入れると、
// 同じ題の気づきが後で根拠つきで出ても、同じ題があるとして入らない。上限は頼みの中だけでなく、保存するときにも守る。PR #237 の ai-review の指摘）
export const NOTE_IDEAS_MAX = 3;
export function toSaved(out: Report, next?: string[]): Report {
  const noteIdeas = cleanNoteIdeas(out.noteIdeas).filter((x) => x.body).slice(0, NOTE_IDEAS_MAX);
  return { summary: out.summary, numbers: out.numbers, highlights: out.highlights, noteIdeas, next: next ?? out.next };
}

// 気づきの形を整える（題が空・文字でないものは捨てる。題は120文字・根拠は4000文字まで）。保存するときも、画面に出すときも使う
export function cleanNoteIdeas(ideas: unknown): Report["noteIdeas"] {
  if (!Array.isArray(ideas)) return [];
  return ideas.flatMap((x) => (isObj(x) && isStr(x.title) && x.title.trim()
    ? [{ title: x.title.trim().slice(0, 120), body: isStr(x.body) ? x.body.trim().slice(0, 4000) : "", topic: isStr(x.topic) ? x.topic : "other" }]
    : []));
}

// 決まった話題だけを認める（"constructor" のような、オブジェクトが元から持つ名前を話題として通さない。PR #237 の ai-review の指摘）
export const noteTopicOf = (topic: unknown): NoteTopic => (typeof topic === "string" && Object.hasOwn(NOTE_TOPICS, topic) ? (topic as NoteTopic) : "other");

// 同じ題の実験メモがあるか（週のまとめの画面で「入れ済み」を出すのにも使う）
export const noteTitled = (title: unknown): boolean => typeof title === "string" && !!db().prepare("SELECT 1 FROM notes WHERE title = ?").get(title.trim().slice(0, 120));
