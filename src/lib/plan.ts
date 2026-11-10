import { callJson, isObj, isStr } from "./ai";
import { db, getSettings, monthSpendUsd, type ProjectRow } from "./db";
import { CERTAINTY_LABEL, CONV, KIND_LABEL, activeLessons, improveBlocked, lessonLine, logEvent, planImprove, projectTotals } from "./loop";
import { endReasons, headline } from "./experiment";
import { funnelText } from "./funnel";
import { AUTO_PLATFORMS, autoPlatforms, postAllowed, type AutoPlatform } from "./snsApi";
import { jstDay, postPromo, safetyQuota } from "./sns";
import { viralHints } from "./viralPosts";
import { budgetState } from "./budget";
import { jstDateTime } from "./format";
import { ANGLE_TYPES, badPostsText, classifyUntyped, isAngleType, postStatsText } from "./postStats";
import { hasKey, modelInfo } from "./models";
import { addProposal, addVoice } from "./voices";
import { outsideText, recordVoiceEffects } from "./outside";
import { addResearch, researchText, runResearch } from "./research";

// 毎日の計画: 毎朝AIが全案件を振り返り、今のネック（届かない・使われない など）を1つ決めて、今日やることを決める
// - やること: 案件の宣伝の投稿 / 宣伝ではない普通の投稿 / ページを直す / 新しい案件づくりを休む / 次のアイデア出しに課題を伝える
// - 回数・時刻・場所・切り口はAIが決める。安全装置（場所ごとの1日の投稿数・月の予算・緊急停止）は計画より優先する
// - 5分ごとの見回りで、時刻が来た予定から1件ずつ実行する。翌朝、目標と結果を見比べて振り返る
// - 返信・フォロー・いいねなど、他人への働きかけはしない

export type Bottleneck = "reach" | "use" | "spread" | "pace" | "other";
export const BOTTLENECK_LABEL: Record<Bottleneck, string> = {
  reach: "届かない（訪問が少ない）",
  use: "使われない（訪問はあるが、登録・利用されない）",
  spread: "広まらない（使われるが、シェアされない）",
  pace: "作るペース（案件が多すぎる・少なすぎる）",
  other: "その他",
};
export type GoalMetric = "visits" | "conversions";
export const GOAL_LABEL: Record<GoalMetric, string> = { visits: "訪問", conversions: "登録・利用" };

export type PlanContent = {
  bottleneck: Bottleneck;
  evidence: string; // 根拠の数字
  certainty: "low" | "mid" | "high";
  review: string; // 昨日（までの計画）の振り返り
  focus: string; // 今日の方針を1文で
  goals: { metric: GoalMetric; target: number; why: string }[];
  pause_reason: string;
  // 目標とは別の「実際にこうなると思う」予想（控えめな目標を立てるAIが有利にならないよう、実測と並べて答え合わせする）
  prediction?: { visits: number; conversions: number; why: string };
};
export type PlanRow = { id: number; day: string; created_at: string; model_id: string; content: string; pause_new: number; idea_note: string | null };
export type TaskKind = "promo" | "plain" | "improve";
export type TaskStatus = "pending" | "running" | "done" | "held" | "failed" | "skipped" | "cancelled"; // held = ページを直したが、チェックで問題が残り承認待ちにした（公開していない）
export type TaskRow = {
  id: number; plan_id: number; at_time: string; kind: TaskKind; platform: string | null; project_id: number | null;
  angle: string | null; reason: string | null; status: TaskStatus; result: string | null; result_url: string | null; done_at: string | null;
  angle_type: string | null; likes: number | null; replies: number | null; reposts: number | null; reactions_at: string | null;
  human_review: string | null; human_note: string | null;
};
export const TASK_KIND_LABEL: Record<TaskKind, string> = { promo: "宣伝の投稿", plain: "普通の投稿", improve: "ページを直す" };

// 計画を書くAI。3社で日ごとに交代し、どのAIの計画が目標に届いたかを比べる（使える候補のうち、担当した日が少ないものに任せる）
export const PLAN_MODELS = ["claude-opus-5-5", "gpt-5.6-sol", "gemini-3.1-pro-preview"];

function planModelFor(): string {
  const usable = PLAN_MODELS.filter((id) => hasKey(modelInfo(id).provider));
  if (!usable.length) return getSettings().loopModel;
  const counts = new Map((db().prepare("SELECT model_id AS m, COUNT(*) AS n FROM daily_plans GROUP BY model_id").all() as { m: string; n: number }[]).map((r) => [r.m, r.n]));
  return [...usable].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || Math.random() - 0.5)[0];
}

// 予想の答え合わせ: 終わった日の計画ごとの、訪問の予想と実測のずれ（AIごと）
// bias がプラスなら実際の方が多い（慎重な予想）、マイナスなら実際の方が少ない（楽観的な予想）
export function predictionStats(): { modelId: string; days: number; mae: number; bias: number; rows: { day: string; predicted: number; actual: number }[] }[] {
  const today = jstNow().day;
  const by = new Map<string, { day: string; predicted: number; actual: number }[]>();
  for (const p of db().prepare("SELECT * FROM daily_plans WHERE day < ? ORDER BY day").all(today) as PlanRow[]) {
    const c = JSON.parse(p.content) as PlanContent;
    if (!c.prediction) continue;
    by.set(p.model_id, [...(by.get(p.model_id) ?? []), { day: p.day, predicted: c.prediction.visits, actual: dayActuals(p.day).visits }]);
  }
  return [...by].map(([modelId, rows]) => ({
    modelId, days: rows.length, rows,
    mae: rows.reduce((n, r) => n + Math.abs(r.actual - r.predicted), 0) / rows.length,
    bias: rows.reduce((n, r) => n + (r.actual - r.predicted), 0) / rows.length,
  }));
}

// 計画のAIの成績: 終わった日の計画ごとの、目標の達成度と予定の消化（今日の分は数えない）
export function planModelStats(): { modelId: string; days: number; goalRate: number | null; taskRate: number }[] {
  const today = jstNow().day;
  const by = new Map<string, { days: number; goal: number[]; task: number[] }>();
  for (const p of db().prepare("SELECT * FROM daily_plans WHERE day < ?").all(today) as PlanRow[]) {
    const g = planProgress(p);
    const m = by.get(p.model_id) ?? { days: 0, goal: [], task: [] };
    m.days++;
    if (g.goalRate !== null) m.goal.push(g.goalRate);
    m.task.push(g.taskRate);
    by.set(p.model_id, m);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [...by].map(([modelId, m]) => ({ modelId, days: m.days, goalRate: avg(m.goal), taskRate: avg(m.task) ?? 0 }));
}

// ---- 提案箱（AIからのお願い・定例会議の提案） ----

export type RequestRow = {
  id: number; plan_id: number | null; created_at: string; title: string; how: string | null; why: string | null; status: "open" | "done" | "declined"; note: string | null; decided_at: string | null;
  source: "plan" | "meeting" | "scene" | "error" | "revival" | "human" | "voice"; proposer: string | null; target: "human" | "system"; score: number | null; meeting_id: number | null;
  scene: string | null; project_id: number | null; ref_id: number | null; ai_reply: string | null;
};

export function openRequests(target?: RequestRow["target"]): RequestRow[] {
  return db().prepare(`SELECT * FROM plan_requests WHERE status = 'open' ${target ? "AND target = ?" : ""} ORDER BY id DESC`).all(...(target ? [target] : [])) as RequestRow[];
}
export function recentRequests(limit = 20): RequestRow[] {
  return db().prepare("SELECT * FROM plan_requests ORDER BY id DESC LIMIT ?").all(limit) as RequestRow[];
}
export function answerRequest(id: number, status: "done" | "declined", note: string) {
  const r = db().prepare("SELECT * FROM plan_requests WHERE id = ?").get(id) as RequestRow | undefined;
  if (!r || r.status !== "open") throw new Error("まだ答えていないお願いだけ答えられます");
  db().prepare("UPDATE plan_requests SET status = ?, note = ?, decided_at = datetime('now') WHERE id = ?").run(status, note.trim().slice(0, 300) || null, id);
  logEvent(null, "human", "plan-request", `提案箱の「${r.title}」: ${status === "done" ? "やった" : "やらない"}${note.trim() ? `（${note.trim().slice(0, 80)}）` : ""}`);
}

const POST_START = 8; // 投稿してよい時間（日本時間）
const POST_END = 22;

function jstNow(): { day: string; hm: string; hour: number } {
  const d = new Date();
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return { day: jstDay(d), hm, hour: Number(hm.slice(0, 2)) };
}

export function planFor(day: string): PlanRow | undefined {
  return db().prepare("SELECT * FROM daily_plans WHERE day = ?").get(day) as PlanRow | undefined;
}
export function todayPlan(): PlanRow | undefined {
  return planFor(jstNow().day);
}
export function planTasks(planId: number): TaskRow[] {
  return db().prepare("SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY at_time, id").all(planId) as TaskRow[];
}
export function recentPlans(limit = 14): PlanRow[] {
  return db().prepare("SELECT * FROM daily_plans ORDER BY day DESC LIMIT ?").all(limit) as PlanRow[];
}

// その日の実際の数字（デモ・仮の数字は除く）
export function dayActuals(day: string): Record<GoalMetric, number> {
  const r = db().prepare(
    "SELECT COALESCE(SUM(m.visits), 0) AS v, COALESCE(SUM(m.signups), 0) AS c FROM metrics m JOIN projects p ON p.id = m.project_id WHERE p.demo = 0 AND m.source != 'simulated' AND m.day = ?",
  ).get(day) as { v: number; c: number };
  return { visits: r.v, conversions: r.c };
}

// どこまで達成したか（予定の消化と、目標の数字）
export function planProgress(plan: PlanRow) {
  const c = JSON.parse(plan.content) as PlanContent;
  const tasks = planTasks(plan.id);
  const counted = tasks.filter((t) => t.status !== "cancelled");
  const done = counted.filter((t) => t.status === "done").length;
  const actual = dayActuals(plan.day);
  const goals = c.goals.map((g) => ({ ...g, actual: actual[g.metric], rate: g.target > 0 ? Math.min(1, actual[g.metric] / g.target) : 1 }));
  return {
    content: c, tasks, done, total: counted.length,
    failed: counted.filter((t) => t.status === "failed").length,
    held: counted.filter((t) => t.status === "held").length,
    skipped: counted.filter((t) => t.status === "skipped").length,
    goals,
    taskRate: counted.length ? done / counted.length : 1,
    goalRate: goals.length ? goals.reduce((n, g) => n + g.rate, 0) / goals.length : null,
    prediction: c.prediction ?? null,
    actual,
  };
}

// アイデア出し・毎日の自動実行から読む
export function planIdeaNote(): string {
  const p = todayPlan();
  return p?.idea_note ? `\n\n今の課題（今日の計画で、全案件を振り返ってAIが決めたもの。踏まえて考えること）: ${p.idea_note}` : "";
}
export function planPausesNew(): string | null {
  const p = todayPlan();
  if (!p?.pause_new) return null;
  return (JSON.parse(p.content) as PlanContent).pause_reason || "今ある案件の集客を優先";
}

// ---- 計画を作る ----

type LivePj = ProjectRow & { v7: number; c7: number };

function liveProjects(): LivePj[] {
  const since = jstDay(new Date(Date.now() - 7 * 86_400_000));
  return (db().prepare("SELECT * FROM projects WHERE stage = 'live' AND demo = 0 AND public_slug IS NOT NULL ORDER BY id").all() as ProjectRow[]).map((p) => {
    const r = db().prepare("SELECT COALESCE(SUM(visits), 0) AS v, COALESCE(SUM(signups), 0) AS c FROM metrics WHERE project_id = ? AND day >= ? AND source != 'simulated'").get(p.id, since) as { v: number; c: number };
    return { ...p, v7: r.v, c7: r.c };
  });
}

type Reacts = { reactions_at: string | null; likes: number | null; replies: number | null; reposts: number | null };
const reactText = (x: Reacts) => (x.reactions_at ? ` 反応: いいね${x.likes ?? 0} 返信${x.replies ?? 0} リポスト${x.reposts ?? 0}` : " 反応: まだ未集計");

function planMaterial(): string {
  const s = getSettings();
  const now = jstNow();
  const live = liveProjects();
  const platforms = s.autoPost ? autoPlatforms() : [];
  const h = headline();
  const ends = endReasons();
  const b = budgetState();
  const projectLines = live.map((p) => {
    const t = projectTotals(p.id);
    const posts = db().prepare("SELECT platform, COUNT(*) AS n, SUM(visits) AS v, MAX(posted_at) AS last FROM sns_posts WHERE project_id = ? AND status = 'posted' GROUP BY platform").all(p.id) as { platform: string; n: number; v: number; last: string }[];
    const pub = p.published_at ? Math.floor((Date.now() - Date.parse(p.published_at.replace(" ", "T") + "Z")) / 86_400_000) : null;
    const gate = improveBlocked(p);
    return `- #${p.id} ${p.title}（${KIND_LABEL[p.kind]}・対象: ${p.target}${pub !== null ? `・公開${pub}日目` : ""}・ページの自動改善: ${gate ? `できない（${gate.reason}）` : "できる"}）直近7日: 訪問${p.v7} ${CONV[p.kind].noun}${p.c7} / 累計: 訪問${t.visits} ${CONV[p.kind].noun}${t.signups}
  投稿: ${posts.map((x) => `${AUTO_PLATFORMS[x.platform as AutoPlatform]?.label ?? x.platform} ${x.n}件（そこからの訪問${x.v ?? 0}）`).join("・") || "まだなし"}${p.growth_focus ? `\n  集客の方針: ${p.growth_focus}` : ""}${funnelText(p) ? `\n  ${funnelText(p).replace(/\n/g, "\n  ")}` : ""}`;
  });
  const recentPosts = (db().prepare(
    `SELECT s.platform, s.angle, s.text, s.visits, s.conversions, s.posted_at, p.title, s.reactions_at, s.likes, s.replies, s.reposts FROM sns_posts s JOIN projects p ON p.id = s.project_id
     WHERE s.status = 'posted' AND s.author = 'ai' AND s.posted_at >= datetime('now', '-10 days') ORDER BY s.id DESC LIMIT 25`,
  ).all() as ({ platform: string; angle: string | null; text: string; visits: number; conversions: number; posted_at: string; title: string } & Reacts)[])
    .map((x) => `- ${jstDateTime(x.posted_at)} ${x.platform} ${x.title}「${x.angle ?? x.text.slice(0, 30)}」訪問${x.visits} 成果${x.conversions}${reactText(x)}`);
  const past = recentPlans(7).map((pl) => {
    const g = planProgress(pl);
    return `- ${pl.day}: ネック「${BOTTLENECK_LABEL[g.content.bottleneck]}」方針「${g.content.focus}」予定 ${g.done}/${g.total}件 済み${g.held ? `・改善したが承認待ちで未公開${g.held}` : ""}${g.failed ? `・失敗${g.failed}` : ""}${g.skipped ? `・見送り${g.skipped}` : ""}${pl.pause_new ? "・新しい案件は休み" : ""}
  目標: ${g.goals.map((x) => `${GOAL_LABEL[x.metric]} ${x.actual}/${x.target}`).join("・") || "なし"}${g.prediction ? ` / 予想（${modelInfo(pl.model_id).label}）: 訪問${g.prediction.visits}→実測${g.actual.visits}・登録/利用${g.prediction.conversions}→実測${g.actual.conversions}` : ""}
  やったこと: ${g.tasks.map((t) => `${t.at_time} ${TASK_KIND_LABEL[t.kind]}${t.platform ? `(${t.platform})` : ""}${t.project_id ? ` #${t.project_id}` : ""}「${(t.angle ?? "").slice(0, 30)}」→${t.status}`).join(" / ") || "なし"}`;
  });
  const plains = (db().prepare("SELECT t.platform, t.angle, t.result, t.done_at, t.reactions_at, t.likes, t.replies, t.reposts FROM plan_tasks t WHERE t.kind = 'plain' AND t.status = 'done' ORDER BY t.id DESC LIMIT 10").all() as ({ platform: string; angle: string; result: string; done_at: string } & Reacts)[])
    .map((x) => `- ${jstDateTime(x.done_at)} ${x.platform}「${(x.result ?? x.angle).slice(0, 50)}」${reactText(x)}`);
  const days = Array.from({ length: 7 }, (_, i) => jstDay(new Date(Date.now() - (6 - i) * 86_400_000)));
  const daily = days.map((d) => { const a = dayActuals(d); return `${d.slice(5)} 訪問${a.visits} 成果${a.conversions}`; }).join(" / ");
  return [
    `今: ${now.day} ${now.hm}（日本時間。以下の日時もすべて日本時間）`,
    `実験の累計: 案件${h.projects}件・公開${h.published}件・育てる段階${h.continued}件・撤退${h.killed}件 / 撤退の理由: ${ends.map((e) => `${e.label}${e.n}件`).join("・") || "まだなし"}`,
    `全案件の1日ごとの数字（直近7日）: ${daily}`,
    outsideText(),
    researchText() || "調べたこと: まだない",
    `公開中の案件:\n${projectLines.join("\n") || "（なし）"}`,
    `自動で投稿できる場所: ${platforms.map((p) => `${AUTO_PLATFORMS[p].label}（宣伝は${postAllowed(p, "promo") ? `1件 約${Math.round(AUTO_PLATFORMS[p].costUsd * s.usdJpy)}円` : "運営者が止めている（予定に入れない）"}・普通の投稿は${postAllowed(p, "plain") ? `約${Math.round(AUTO_PLATFORMS[p].plainCostUsd * s.usdJpy)}円` : "運営者が止めている（予定に入れない）"}。直近24時間の投稿 ${safetyQuota(p).used}件・安全装置 ${s.postSafetyPerDay}件）`).join(" / ") || "なし（自動投稿がオフ、またはキーがない。投稿の予定は入れない）"}`,
    `投稿してよい時間: ${POST_START}〜${POST_END}時`,
    `予算: 今月の残り 約${Math.max(0, Math.round(s.monthlyBudgetJpy - monthSpendUsd() * s.usdJpy))}円（月${s.monthlyBudgetJpy}円）・新しい案件1件 約${Math.round(b.perProject)}円・今日の予算のペースで作れる新しい案件 ${b.newToday}件`,
    `最近のAIの宣伝の投稿と、そこからの訪問・成果:\n${recentPosts.join("\n") || "（なし）"}`,
    `最近の普通の投稿（リンクがないので、訪問の数は分からない。反応は投稿の翌日と3日後に取り込む）:\n${plains.join("\n") || "（なし）"}`,
    `最近の計画と結果:\n${past.join("\n") || "（まだなし。今日が最初の計画）"}`,
    `公開サイトの一覧から来た人（投稿のリンクとは別。累計）: ${(() => { const r = db().prepare("SELECT COALESCE(SUM(index_visits), 0) AS v, COALESCE(SUM(index_uses), 0) AS u FROM projects WHERE demo = 0").get() as { v: number; u: number }; return `訪問${r.v}人・登録/利用${r.u}人`; })()}`,
    postStatsText() || "効いた手の集計: まだ投稿がない",
    `運営者からの提案（提案箱にあなたが入れたもの。返事待ち）:\n${(db().prepare("SELECT id, title, how FROM plan_requests WHERE source = 'human' AND status = 'open' ORDER BY id DESC LIMIT 10").all() as { id: number; title: string; how: string | null }[]).map((r) => `- 【${r.id}】${r.title}${r.how ? `: ${r.how}` : ""}`).join("\n") || "（なし）"}`,
    `提案箱（あなたたちAIからのお願い・定例会議の提案。直近30日）:\n${(db().prepare("SELECT * FROM plan_requests WHERE created_at >= datetime('now', '-30 days') ORDER BY id DESC").all() as RequestRow[]).map((r) => `- 「${r.title}」→ ${r.status === "open" ? "まだ返事なし" : r.status === "done" ? `やった${r.decided_at ? `（${jstDateTime(r.decided_at)}）` : ""}` : "見送り"}${r.note ? `・運営者のひとこと: ${r.note}` : ""}`).join("\n") || "（まだなし）"}`,
    `教訓:\n${activeLessons().slice(0, 10).map(lessonLine).join("\n") || "（まだなし）"}`,
    `保留中の案件（人が決めたもの。宣伝も改善も予定に入れない）:\n${(db().prepare("SELECT id, title, hold_until FROM projects WHERE stage = 'hold' AND demo = 0 ORDER BY id").all() as { id: number; title: string; hold_until: string }[]).map((p) => `- #${p.id} ${p.title}（${p.hold_until}に再開）`).join("\n") || "（なし）"}`,
  ].join("\n\n") + viralHints("sns") + badPostsText();
}

type PlanOut = PlanContent & {
  pause_new: boolean;
  idea_note: string;
  requests?: { title: string; how: string; why: string }[];
  voice?: string;
  replies?: { id: number; reply: string }[];
  voice_effects?: unknown;
  research?: { question?: unknown; why?: unknown; how?: unknown; project_id?: unknown } | null;
  tasks: { time: string; kind: TaskKind; platform?: string; project_id?: number; type?: string; angle: string; reason: string }[];
};

const isPlanOut = (v: unknown): v is PlanOut =>
  isObj(v) && isStr(v.bottleneck) && isStr(v.focus) && Array.isArray(v.goals) && Array.isArray(v.tasks) &&
  v.tasks.every((t) => isObj(t) && isStr(t.time) && isStr(t.kind));

export async function createPlan({ force = false } = {}): Promise<number> {
  const s = getSettings();
  const now = jstNow();
  const existing = planFor(now.day);
  if (existing && !force) return existing.id;
  // 集計の前に、型がまだない投稿に型を付けておく（失敗しても計画は作る）
  await classifyUntyped().catch((e) => logEvent(null, "system", "classify-error", `投稿の切り口の分類でエラー: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`));
  // 作り直すときは、同じAIに作り直させる（比べ合いを公平にするため）
  const model = existing && PLAN_MODELS.includes(existing.model_id) && hasKey(modelInfo(existing.model_id).provider) ? existing.model_id : planModelFor();
  const out = await callJson<PlanOut>({
    purpose: "毎日の計画",
    modelId: model,
    system: `あなたは「AIが自動でプロダクトを作る実験」の運営責任者です。毎朝、公開中の全案件と最近の結果を振り返り、今いちばんのネックを1つ決めて、今日1日にやることを決めます。決めたことは、そのまま自動で実行されます。
ネック（bottleneck）は次から1つ: reach（届かない・訪問が少ない）/ use（訪問はあるが登録・利用されない）/ spread（使われるがシェアされない）/ pace（作るペースが合っていない）/ other
今日できること（tasks）:
- promo: 公開中の案件の宣伝の投稿（リンク付き）。project_id・platform・angle（切り口）を決める。宣伝は、直近7日の訪問か利用が多い上位3案件に集中する（薄く広く投稿すると、どの案件も判断できる量に届かないため）。それ以外の案件は週1件まで。ただし公開7日未満の案件は、まだ数字がないので例外として1〜2件出してよい。上位3案件は、反応が出ている場所を中心に、まだ試していない切り口を混ぜる。「すぐ使える文例・チェックリスト」（freebie）は、投稿の中で対象の人がそのまま使える文例・チェックリストを見せ、続きはツールやページで、とつなぐ切り口
- plain: 宣伝ではない普通の投稿（リンクなし。運営アカウント「Hitoride」の投稿）。platform と angle（話題）を決める。話題は次のどれか: 実験の記録（本物の数字）/ 作る裏側（実際にあった出来事）/ 案件の対象の人に役立つ小ネタ / そのまま使える文例・チェックリスト / 気軽な問いかけ
- promo と plain には、切り口の型（type）も付ける: ${Object.entries(ANGLE_TYPES).map(([k, v]) => `${k}（${v}）`).join(" / ")}
- improve: 集客中の案件のページ（ツールなら画面）を直す。project_id と angle（何をどう直すか、具体的に）を決める。1日1件まで。訪問がある程度あるのに登録・利用されない案件で、材料に「ページの自動改善: できる」とある案件だけ。結果が「held」（直したが承認待ちで未公開）の改善は、公開ページは変わっていないので、改善の効果として数字を読まない
決めること:
- 投稿の回数・時刻・場所・宣伝と普通の投稿の割合は、あなたが決める。宣伝ばかりのアカウントに見えないよう、普通の投稿も混ぜる。同じ時刻に固めず、間をあける
- 時刻は今より後で、投稿は${POST_START}〜${POST_END}時の間（"HH:MM"）。使える場所（自動で投稿できる場所）以外には予定を入れない
- 安全装置（場所ごとの1日の投稿数）を超える予定は入れない。費用も考える（X はリンク付きの投稿が高い）
- pause_new: ネックが「届かない」なのに新しい案件を増やしても届かない案件が増えるだけ、のようなときは true にして、今日は新しい案件づくりを休む
- idea_note: 次のアイデア出しに伝えたい、今の課題（例: 最初の利用者に届けやすい場所がはっきりした案を優先する）。なければ空
- goals: 今日の目標の数字（visits = 全案件の訪問の合計、conversions = 登録・利用の合計）。直近の数字から、背伸びすれば届く値にする
- prediction: 目標とは別に、この計画を実行したら、今日の訪問と登録・利用は実際にいくつになると思うか（願望ではなく予想。目標と同じでなくてよい）と、その理由。最近の計画の「予想→実測」のずれを見て、楽観・悲観に偏っていたら直す
- review: 最近の計画の予定と目標が、実際どうだったか。効いた手・効かなかった手と、今日それをどう変えるか（最初の計画なら、今の状況のまとめ）。運営者に頼んだことをやってもらえた場合は、その前後で数字がどう変わったかも見る
- voice: 社員としてのひとこと（つぶやき程度、60文字以内）。感想・気づき・心配・ダメ出し・試したいことなど何でもよい。数字や出来事は材料にあるものだけを使い、体験談は作らない
- research: 今の判断に効くのに分からないことがあれば、Webの公開情報で調べてもらう問いを1件だけ（例: 「#35 が使われない原因が分からない。類似の無料ツールを調べ、すでに無料でできることと、#35 に足りないことを確かめる」）。{"question":"分からないこと","why":"分かるとどの判断が変わるか","how":"どう調べるか","project_id":案件の番号（全体についてなら null）}。調べなくても決められる日・Webでは分からないこと（自社の利用者の気持ちなど）・最近調べたことと同じ問いは null。結果は翌朝の材料に出典つきで入る
- voice_effects: 外の声（実際の人の反応）や調べたことを根拠に、今日の計画で何かを変えたときだけ。[{"voice_ids":[声の番号],"research_ids":[調べものの番号],"project_id":案件の番号,"change":"何をどう変えたか"}]。外の声はAIどうしの解釈より優先する
- replies: 運営者が提案箱に入れた提案（材料の「運営者からの提案」）それぞれへの返事。どう受け止め、今日の計画にどう反映したか（反映できないなら理由）を1〜2文で
- requests: あなた（AI）は自分ではできないが、運営者（人）がやると効きそうなことを0〜2件頼める。季節が合わず今は集客しても届かない案件があれば「#番号を○月まで保留にしてほしい」と頼んでもよい（保留にできるのは運営者だけ）。例: 対象の人が集まるコミュニティに参加して自分の言葉で紹介する / アカウントのプロフィールの文や固定の投稿を変える / 知り合いに見てもらって感想を聞く。title は短く、how は具体的な手順、why は数字の根拠。返事がまだのお願い・断られたお願いと同じものは出さない。なければ空の配列
守ること:
- 材料にある数字だけを使う。件数が少ないときは certainty を low にし、「まだ偶然の可能性が高い」と書く
- 効かなかった手を同じように繰り返さない。回数を増やすより、切り口・場所・時刻を変えることを先に試す
- 切り口どうしを比べるときは、場所と時間帯をそろえる（例: 同じ場所・同じ時間帯で、完成見本の切り口と共感の切り口を別の日に出す）。場所も時間帯も切り口も同時に変えると、どれが効いたか分からなくなる
- 「効いた手の集計」で訪問・反応が多い組み合わせ（場所・時間帯・切り口の型）を多めに使う。ただし件数が少ないうちは決めつけず、まだ試していない組み合わせも毎日少し混ぜる（1日の投稿の3割くらい）
- 返信・フォロー・いいねなど、他人への働きかけの予定は入れない
形式: {"bottleneck":"reach","evidence":"根拠の数字","certainty":"low|mid|high","review":"振り返り","focus":"今日の方針を1文で","goals":[{"metric":"visits","target":数,"why":"理由"}],"prediction":{"visits":数,"conversions":数,"why":"理由"},"pause_new":false,"pause_reason":"休む理由（休まないなら空）","idea_note":"","requests":[{"title":"短い題","how":"具体的な手順","why":"根拠"}],"voice":"ひとこと","voice_effects":[],"research":{"question":"","why":"","how":"","project_id":null} または null,"replies":[{"id":提案の番号,"reply":"返事"}],"tasks":[{"time":"HH:MM","kind":"promo|plain|improve","platform":"x|threads|bluesky","project_id":番号,"type":"切り口の型","angle":"切り口・話題・直す内容","reason":"理由"}]}`,
    user: planMaterial(),
    validate: isPlanOut,
  });

  // 決まりに合わない予定は落とす（時刻・場所・案件・安全装置・1日1件まで）
  const platforms = new Set<string>(s.autoPost ? autoPlatforms() : []);
  const live = new Set(liveProjects().map((p) => p.id));
  const perPlatform = new Map<string, number>();
  let improves = 0;
  const tasks = out.tasks.filter((t) => {
    if (!/^\d{2}:\d{2}$/.test(t.time) || t.time <= now.hm) return false;
    if (t.kind === "improve") {
      // 判断からの改善と同じ条件（承認モード・ツールの変更・改善の回数・予算など）に合わない案件は、予定に入れない
      const lp = liveProjects().find((x) => x.id === Number(t.project_id));
      if (!lp || improves >= 1 || improveBlocked(lp)) return false;
      improves++;
      return true;
    }
    if (t.kind !== "promo" && t.kind !== "plain") return false;
    const h = Number(t.time.slice(0, 2));
    if (h < POST_START || h >= POST_END || !t.platform || !platforms.has(t.platform)) return false;
    if (t.kind === "promo" && !live.has(Number(t.project_id))) return false;
    if (!postAllowed(t.platform, t.kind)) return false;
    const n = (perPlatform.get(t.platform) ?? 0) + 1;
    const q = safetyQuota(t.platform);
    if (q.used + n > q.cap) return false;
    perPlatform.set(t.platform, n);
    return true;
  }).slice(0, 30);

  const bottleneck = (Object.keys(BOTTLENECK_LABEL) as Bottleneck[]).includes(out.bottleneck) ? out.bottleneck : "other";
  const content: PlanContent = {
    bottleneck,
    evidence: String(out.evidence ?? "").slice(0, 600),
    certainty: ["low", "mid", "high"].includes(out.certainty) ? out.certainty : "low",
    review: String(out.review ?? "").slice(0, 1200),
    focus: String(out.focus ?? "").slice(0, 200),
    goals: out.goals.filter((g) => isObj(g) && (g.metric === "visits" || g.metric === "conversions") && Number(g.target) > 0)
      .slice(0, 2).map((g) => ({ metric: g.metric, target: Math.round(Number(g.target)), why: String(g.why ?? "").slice(0, 200) })),
    pause_reason: out.pause_new ? String(out.pause_reason ?? "").slice(0, 200) : "",
    prediction: isObj(out.prediction) && Number.isFinite(Number(out.prediction.visits))
      ? { visits: Math.max(0, Math.round(Number(out.prediction.visits))), conversions: Math.max(0, Math.round(Number(out.prediction.conversions) || 0)), why: String(out.prediction.why ?? "").slice(0, 200) }
      : undefined,
  };
  const conn = db();
  const id = conn.transaction(() => {
    if (existing) {
      // 作り直すとき: まだ実行していない予定は、取りやめにする
      conn.prepare("UPDATE plan_tasks SET status = 'cancelled', result = '計画を作り直したため取りやめ' WHERE plan_id = ? AND status = 'pending'").run(existing.id);
      conn.prepare("UPDATE daily_plans SET content = ?, pause_new = ?, idea_note = ?, model_id = ?, created_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(content), out.pause_new ? 1 : 0, out.idea_note?.trim().slice(0, 300) || null, model, existing.id);
      return existing.id;
    }
    return Number(conn.prepare("INSERT INTO daily_plans (day, model_id, content, pause_new, idea_note) VALUES (?, ?, ?, ?, ?)")
      .run(now.day, model, JSON.stringify(content), out.pause_new ? 1 : 0, out.idea_note?.trim().slice(0, 300) || null).lastInsertRowid);
  })();
  const ins = conn.prepare("INSERT INTO plan_tasks (plan_id, at_time, kind, platform, project_id, angle, reason, angle_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const t of tasks) {
    const type = t.kind === "improve" ? null : isAngleType(t.type) ? t.type : "other";
    ins.run(id, t.time, t.kind, t.kind === "improve" ? null : t.platform, t.kind === "plain" ? null : Number(t.project_id), String(t.angle ?? "").slice(0, 300), String(t.reason ?? "").slice(0, 300), type);
  }
  // お願い（返事がまだのものと同じ題は入れない）
  const reqs = (Array.isArray(out.requests) ? out.requests : []).filter((r) => isObj(r) && isStr(r.title)).slice(0, 2)
    .filter((r) => addProposal({ title: r.title, how: String(r.how ?? ""), why: String(r.why ?? ""), target: "human", source: "plan", proposer: model, scene: "朝会", planId: id }));
  if (isStr(out.voice)) addVoice({ modelId: model, scene: "朝会", text: out.voice });
  recordVoiceEffects(out.voice_effects, { scene: "朝会", modelId: model });
  // 調べもの（1件だけ）。画面を待たせないよう、裏で調べる
  const rq = out.research;
  if (rq && isStr(rq.question)) {
    const pid = Number(rq.project_id);
    const rid = addResearch({ planId: id, projectId: Number.isFinite(pid) && pid > 0 ? pid : null, question: rq.question, why: isStr(rq.why) ? rq.why : "", how: isStr(rq.how) ? rq.how : "", askedBy: model });
    void runResearch(rid);
  }
  for (const r of Array.isArray(out.replies) ? out.replies : []) {
    if (isObj(r) && isStr(r.reply)) conn.prepare("UPDATE plan_requests SET ai_reply = ? WHERE id = ? AND source = 'human'").run(`${modelInfo(model).label}（${now.day}の朝会）: ${r.reply.slice(0, 400)}`, Number(r.id));
  }
  // 前の日までの、実行されずに残った予定は見送りにする
  conn.prepare("UPDATE plan_tasks SET status = 'skipped', result = '時間内に実行できなかった' WHERE status = 'pending' AND plan_id IN (SELECT id FROM daily_plans WHERE day < ?)").run(now.day);
  logEvent(null, "ai", "plan", `今日の計画${existing ? "を作り直しました" : ""}: ネック「${BOTTLENECK_LABEL[bottleneck]}」${content.focus}（担当 ${modelInfo(model).label}・予定${tasks.length}件${out.pause_new ? "・新しい案件は休み" : ""}${reqs.length ? `・あなたへのお願い${reqs.length}件` : ""}）`);
  return id;
}

// 毎朝（毎日の自動実行の時刻以降）に1回だけ作る
export async function maybeCreatePlan() {
  const s = getSettings();
  if (!s.dailyPlan || s.killSwitch) return;
  if (jstNow().hour < Math.min(s.dailyHour, POST_START)) return;
  if (todayPlan()) return;
  // 失敗した直後は、1時間あけてから試す（5分ごとに失敗し続けないように）
  if (db().prepare("SELECT 1 FROM events WHERE kind = 'plan-error' AND at >= datetime('now', '-1 hours')").get()) return;
  try {
    await createPlan();
  } catch (e) {
    logEvent(null, "system", "plan-error", `今日の計画を作れませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  }
}

// ---- 予定を実行する ----

async function writePlain(platform: AutoPlatform, angle: string): Promise<string> {
  const h = headline();
  const live = liveProjects();
  const events = (db().prepare("SELECT at, message FROM events WHERE actor IN ('ai', 'system') AND kind NOT LIKE '%error%' AND at >= datetime('now', '-3 days') ORDER BY id DESC LIMIT 40").all() as { at: string; message: string }[])
    .map((e) => `- ${e.message.slice(0, 120)}`).join("\n");
  const past = (db().prepare("SELECT result FROM plan_tasks WHERE kind = 'plain' AND status = 'done' ORDER BY id DESC LIMIT 8").all() as { result: string }[]).map((x) => `- ${x.result}`).join("\n");
  const def = AUTO_PLATFORMS[platform];
  const out = await callJson<{ text: string }>({
    purpose: "普通の投稿",
    system: `あなたは、AIにプロダクト作りを任せる実験をしている運営アカウント「Hitoride」として、${def.label}に宣伝ではない普通の投稿を1件書きます。
守ること:
- ${def.plainHint}。URL・@で始まる他人のアカウント名は書かない。ハッシュタグは使っても1つまで。絵文字は控えめに
- 数字や出来事は、材料にある本物のものだけを使う。運営者の体験談・感想、架空の数字・実績・利用者の声を作らない
- 小ネタは断言しすぎず、医療・法律・お金の助言はしない
- 時事・政治・事件、他人や他社のサービスへの言及はしない
- 宣伝にしない（サービスへの誘導や「ぜひ使って」は書かない）。問いかけは、気軽に答えられるものにする
- 最近の普通の投稿と、同じ話題・同じ書き出しにしない
形式: {"text":"本文"}`,
    user: `今日の話題: ${angle}${badPostsText("plain")}\n\n実験の累計: 案件${h.projects}件・公開${h.published}件・撤退${h.killed}件\n公開中の案件: ${live.map((p) => `${p.title}（対象: ${p.target}）`).join(" / ") || "なし"}\n\n最近の出来事:\n${events || "（なし）"}\n\n最近の普通の投稿:\n${past || "（なし）"}`,
    validate: (v): v is { text: string } => isObj(v) && isStr(v.text),
  });
  return out.text.trim();
}

async function runTask(t: TaskRow): Promise<{ status: TaskStatus; result: string; url?: string }> {
  const s = getSettings();
  // 計画を立てたあとで人が保留にした案件には、宣伝も改善もしない
  if (t.project_id && (db().prepare("SELECT stage FROM projects WHERE id = ?").get(t.project_id) as { stage: string } | undefined)?.stage === "hold") {
    return { status: "skipped", result: "人が保留にした案件のため見送り" };
  }
  if (t.kind === "improve") {
    if (!t.project_id) return { status: "skipped", result: "案件が決まっていない" };
    // 公開した・承認待ちにした・条件に合わず直さなかった、を分けて残す（翌朝のAIが「直した結果」と読み違えないように）
    const r = await planImprove(t.project_id, t.angle ?? "");
    return r.kind === "published" ? { status: "done", result: `ページを直して公開しました: ${r.detail}` }
      : r.kind === "held" ? { status: "held", result: r.detail }
      : { status: "skipped", result: `直しませんでした（${r.detail}）` };
  }
  const platform = t.platform as AutoPlatform;
  if (!s.autoPost) return { status: "skipped", result: "自動投稿がオフのため見送り" };
  if (!AUTO_PLATFORMS[platform]?.configured()) return { status: "skipped", result: "この場所のキーがないため見送り" };
  if (!postAllowed(platform, t.kind === "promo" ? "promo" : "plain")) return { status: "skipped", result: `設定で、この場所の${t.kind === "promo" ? "宣伝" : "普通"}の投稿を止めているため見送り` };
  const quota = safetyQuota(platform);
  if (quota.used >= quota.cap) {
    logEvent(null, "system", "plan-cap", `${AUTO_PLATFORMS[platform].label}の投稿が安全装置（直近24時間で${quota.cap}件）に届いたため、予定を見送りました`);
    return { status: "skipped", result: `安全装置（直近24時間で${quota.cap}件）に届いたため見送り` };
  }
  if (monthSpendUsd() * s.usdJpy >= s.monthlyBudgetJpy) return { status: "skipped", result: "今月の予算の上限に達したため見送り" };
  if (t.kind === "promo") {
    if (!t.project_id) return { status: "skipped", result: "案件が決まっていない" };
    const url = await postPromo(t.project_id, platform, t.angle ?? "");
    if (!url) return { status: "skipped", result: "下書きが長すぎたため見送り" };
    // 効いた手の集計のため、投稿にも切り口の型を付ける
    if (t.angle_type) db().prepare("UPDATE sns_posts SET angle_type = ? WHERE post_url = ?").run(t.angle_type, url);
    const text = (db().prepare("SELECT text FROM sns_posts WHERE post_url = ?").get(url) as { text: string } | undefined)?.text ?? "";
    return { status: "done", result: text, url };
  }
  // 普通の投稿
  const def = AUTO_PLATFORMS[platform];
  let text = await writePlain(platform, t.angle ?? "");
  if (/https?:\/\/|(^|\s)@\w/.test(text)) return { status: "skipped", result: `URLやアカウント名が入ったため見送り: ${text.slice(0, 60)}` };
  if (!def.plainFits(text)) text = [...text].slice(0, 120).join("");
  if (!def.plainFits(text)) return { status: "skipped", result: "長すぎたため見送り" };
  const record = (cost: number, error: string | null) =>
    db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (NULL, ?, ?, 0, 0, ?, ?)").run(`${def.label}への普通の投稿`, `${platform}-api`, cost, error);
  try {
    const posted = await def.postPlain(text);
    record(def.plainCostUsd, null);
    logEvent(null, "ai", "sns-post", `${def.label}に普通の投稿: ${text.slice(0, 60)}… ${posted.url}`);
    return { status: "done", result: text, url: posted.url };
  } catch (e) {
    record(0, (e instanceof Error ? e.message : String(e)).slice(0, 300));
    throw e;
  }
}

// 5分ごとの見回りから呼ぶ。時刻が来た予定を、1回に1件だけ実行する（投稿が固まらないように）
export async function runPlanTasks(): Promise<void> {
  const s = getSettings();
  if (!s.dailyPlan || s.killSwitch) return;
  const now = jstNow();
  const plan = planFor(now.day);
  if (!plan) return;
  // 投稿の時間を過ぎた予定は見送り
  db().prepare(`UPDATE plan_tasks SET status = 'skipped', result = '投稿してよい時間（${POST_END}時まで）を過ぎた', done_at = datetime('now') WHERE plan_id = ? AND status = 'pending' AND kind != 'improve' AND ? >= ?`)
    .run(plan.id, now.hm, `${POST_END}:00`);
  // 実行中にサーバーが止まった予定は、失敗にする
  db().prepare("UPDATE plan_tasks SET status = 'failed', result = '実行中にサーバーが止まった', done_at = datetime('now') WHERE status = 'running' AND done_at < datetime('now', '-30 minutes')").run();
  const t = db().prepare("SELECT * FROM plan_tasks WHERE plan_id = ? AND status = 'pending' AND at_time <= ? ORDER BY at_time, id LIMIT 1").get(plan.id, now.hm) as TaskRow | undefined;
  if (!t) return;
  // 実行中に次の見回りで二重に実行しないよう、先に印を付ける
  db().prepare("UPDATE plan_tasks SET status = 'running', done_at = datetime('now') WHERE id = ? AND status = 'pending'").run(t.id);
  let r: { status: TaskStatus; result: string; url?: string };
  try {
    r = await runTask(t);
  } catch (e) {
    r = { status: "failed", result: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
  db().prepare("UPDATE plan_tasks SET status = ?, result = ?, result_url = ?, done_at = datetime('now') WHERE id = ?").run(r.status, r.result.slice(0, 600), r.url ?? null, t.id);
  const label = `${t.at_time} ${TASK_KIND_LABEL[t.kind]}${t.platform ? `（${AUTO_PLATFORMS[t.platform as AutoPlatform]?.label ?? t.platform}）` : ""}`;
  logEvent(t.project_id, r.status === "failed" ? "system" : "ai", r.status === "failed" ? "plan-task-error" : "plan-task",
    `今日の計画の予定「${label}」: ${r.status === "done" ? "済み" : r.status === "held" ? `承認待ち・未公開（${r.result.slice(0, 120)}）` : r.status === "failed" ? `失敗（${r.result.slice(0, 120)}）` : `見送り（${r.result.slice(0, 120)}）`}`);
}

// 人が予定を取りやめる
export function cancelTask(id: number) {
  const t = db().prepare("SELECT * FROM plan_tasks WHERE id = ?").get(id) as TaskRow | undefined;
  if (!t || t.status !== "pending") throw new Error("まだ実行していない予定だけ取りやめられます");
  db().prepare("UPDATE plan_tasks SET status = 'cancelled', result = 'あなたが取りやめ', done_at = datetime('now') WHERE id = ?").run(id);
  logEvent(t.project_id, "human", "plan-task", `今日の計画の予定「${t.at_time} ${TASK_KIND_LABEL[t.kind]}」を取りやめました`);
}

export function certaintyLabel(c: PlanContent["certainty"]): string {
  return CERTAINTY_LABEL[c];
}
