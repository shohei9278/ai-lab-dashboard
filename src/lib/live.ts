import { db, getSettings } from "./db";
import { activityList, buildingList, ideaRunning, liveNotesList } from "./loop";
import { modelInfo } from "./models";
import { schedulerStatus } from "./scheduler";

// ライブ画面用: 数秒ごとに読みに来る。いまAIがやっていること・動く数字・AIの呼び出しのログ・AIの「会話」
// 時刻はすべて UTC の "YYYY-MM-DD HH:MM:SS"（画面で日本時間に直す）

export type FeedItem = {
  key: string;
  at: string;
  who: string; // 話し手（AIの名前・あなた・システム）
  provider: string | null; // 吹き出しの色（anthropic / openai / google）
  kind: string; // 何の発言か（アイデアの採点・判断・議論・投稿など）
  text: string;
  project: string | null;
};

const label = (id: string) => modelInfo(id).label;
const provider = (id: string) => (id.endsWith("-api") || id.startsWith("gpt-image") ? null : modelInfo(id).provider);

function feed(): FeedItem[] {
  const items: FeedItem[] = [];
  // アイデアの候補（作者の狙い）と、各社の採点の理由
  const cands = db().prepare("SELECT id, at, author_model, title, payload FROM idea_candidates ORDER BY id DESC LIMIT 12").all() as { id: number; at: string; author_model: string; title: string; payload: string }[];
  for (const c of cands) {
    const idea = JSON.parse(c.payload) as { reason?: string };
    items.push({ key: `ic${c.id}`, at: c.at, who: label(c.author_model), provider: provider(c.author_model), kind: "アイデアを提案", text: `「${c.title}」${idea.reason ? `— ${idea.reason}` : ""}`, project: null });
    const scores = db().prepare("SELECT id, scorer_model, score, reason FROM idea_scores WHERE candidate_id = ?").all(c.id) as { id: number; scorer_model: string; score: number; reason: string | null }[];
    for (const sc of scores) {
      items.push({ key: `is${sc.id}`, at: c.at, who: label(sc.scorer_model), provider: provider(sc.scorer_model), kind: `「${c.title}」を採点`, text: `${sc.score}点。${sc.reason ?? ""}`, project: null });
    }
  }
  // LPの候補の採点
  const lpScores = db().prepare(
    `SELECT s.id, s.scorer_model, s.score, s.reason, c.at, c.label, p.title FROM lp_candidate_scores s JOIN lp_candidates c ON c.id = s.candidate_id JOIN projects p ON p.id = c.project_id ORDER BY s.id DESC LIMIT 12`,
  ).all() as { id: number; scorer_model: string; score: number; reason: string | null; at: string; label: string; title: string }[];
  for (const s of lpScores) items.push({ key: `ls${s.id}`, at: s.at, who: label(s.scorer_model), provider: provider(s.scorer_model), kind: `LPの候補${s.label}を採点`, text: `${s.score}点。${s.reason ?? ""}`, project: s.title });
  // 判断（担当と裏比較）
  const DEC: Record<string, string> = { continue: "続ける", improve: "改善", collect: "集客を続ける", kill: "撤退", rethink: "集客を見直す" };
  const judges = db().prepare(
    `SELECT j.id, j.at, j.model_id, j.is_primary, j.decision, j.reason, p.title FROM shadow_judgments j JOIN projects p ON p.id = j.project_id WHERE j.decision IS NOT NULL ORDER BY j.id DESC LIMIT 12`,
  ).all() as { id: number; at: string; model_id: string; is_primary: number; decision: string; reason: string | null; title: string }[];
  for (const j of judges) items.push({ key: `j${j.id}`, at: j.at, who: label(j.model_id), provider: provider(j.model_id), kind: j.is_primary ? "判断（担当）" : "判断（別のAIの意見）", text: `「${DEC[j.decision] ?? j.decision}」— ${j.reason ?? ""}`, project: j.title });
  // AI同士の議論
  const debates = db().prepare(
    `SELECT d.id, d.at, d.payload, p.title FROM debates d JOIN shadow_judgments j ON j.id = d.round_id JOIN projects p ON p.id = j.project_id WHERE d.payload IS NOT NULL ORDER BY d.id DESC LIMIT 4`,
  ).all() as { id: number; at: string; payload: string; title: string }[];
  for (const d of debates) {
    const r = JSON.parse(d.payload) as { positions: { modelId: string; final: string; argument: string; changed: boolean }[] };
    r.positions.forEach((x, i) => items.push({ key: `d${d.id}-${i}`, at: d.at, who: label(x.modelId), provider: provider(x.modelId), kind: x.changed ? "議論で考えを変えた" : "議論で反論", text: `「${DEC[x.final] ?? x.final}」— ${x.argument}`, project: d.title }));
  }
  // SNSへの投稿
  const PL: Record<string, string> = { x: "X", threads: "Threads", bluesky: "Bluesky" };
  const posts = db().prepare(`SELECT s.id, s.posted_at, s.platform, s.text, p.title FROM sns_posts s JOIN projects p ON p.id = s.project_id WHERE s.status = 'posted' ORDER BY s.posted_at DESC LIMIT 8`).all() as { id: number; posted_at: string; platform: string; text: string; title: string }[];
  for (const p of posts) items.push({ key: `p${p.id}`, at: p.posted_at, who: "AI（Hitoride）", provider: null, kind: `${PL[p.platform] ?? p.platform}に投稿`, text: p.text, project: p.title });
  // SNSのコメントと返信の案
  const comments = db().prepare(`SELECT c.id, c.fetched_at, c.author, c.text, c.draft, p.title FROM sns_comments c JOIN projects p ON p.id = c.project_id ORDER BY c.id DESC LIMIT 6`).all() as { id: number; fetched_at: string; author: string; text: string; draft: string | null; title: string }[];
  for (const c of comments) {
    items.push({ key: `c${c.id}`, at: c.fetched_at, who: c.author, provider: null, kind: "コメント", text: c.text, project: c.title });
    if (c.draft) items.push({ key: `cr${c.id}`, at: c.fetched_at, who: "AI（返信の案）", provider: null, kind: "返信の案", text: c.draft, project: c.title });
  }
  // まだDBに書かれていない途中経過（届いたばかりのアイデアなど）。DBに書かれた回のものは、DBの方を出す
  const saved = new Set((db().prepare("SELECT DISTINCT batch_id AS b FROM idea_candidates ORDER BY id DESC LIMIT 20").all() as { b: string }[]).map((r) => r.b));
  for (const n of liveNotesList()) {
    if (saved.has(n.batch) && n.kind.startsWith("アイデアを提案")) continue;
    items.push({ key: n.key, at: n.at, who: n.who, provider: n.provider, kind: n.kind, text: n.text, project: null });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
}

export function liveSnapshot() {
  const s = getSettings();
  const calls = db().prepare(
    `SELECT c.id, c.at, c.purpose, c.model_id, c.cost_usd, c.error, p.title FROM ai_calls c LEFT JOIN projects p ON p.id = c.project_id ORDER BY c.id DESC LIMIT 30`,
  ).all() as { id: number; at: string; purpose: string; model_id: string; cost_usd: number; error: string | null; title: string | null }[];
  const events = db().prepare(
    `SELECT e.id, e.at, e.actor, e.kind, e.message, p.title FROM events e LEFT JOIN projects p ON p.id = e.project_id ORDER BY e.id DESC LIMIT 30`,
  ).all() as { id: number; at: string; actor: string; kind: string; message: string; title: string | null }[];
  const today = db().prepare("SELECT COALESCE(SUM(visits), 0) AS v, COALESCE(SUM(signups), 0) AS c FROM metrics WHERE day = date('now', 'localtime')").get() as { v: number; c: number };
  const total = db().prepare("SELECT COALESCE(SUM(visits), 0) AS v, COALESCE(SUM(signups), 0) AS c FROM metrics").get() as { v: number; c: number };
  const costToday = (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s, COUNT(*) AS n FROM ai_calls WHERE at >= datetime('now', 'localtime', 'start of day', 'utc')").get() as { s: number; n: number });
  const costMonth = (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_calls WHERE strftime('%Y-%m', at) = strftime('%Y-%m', 'now')").get() as { s: number }).s;
  const postsToday = (db().prepare("SELECT COUNT(*) AS n FROM sns_posts WHERE status = 'posted' AND posted_at >= datetime('now', 'localtime', 'start of day', 'utc')").get() as { n: number }).n;
  const live = (db().prepare("SELECT COUNT(*) AS n FROM projects WHERE stage = 'live' AND demo = 0").get() as { n: number }).n;
  const titles = new Map((db().prepare("SELECT id, title FROM projects").all() as { id: number; title: string }[]).map((p) => [p.id, p.title]));
  const sch = schedulerStatus();
  return {
    now: new Date().toISOString(),
    nextTick: sch.nextTick ? new Date(sch.nextTick).toISOString() : null,
    everyMinutes: sch.checkEveryMinutes,
    dailyHour: s.dailyHour,
    digestHour: s.digestHour,
    killSwitch: s.killSwitch,
    building: buildingList().map((b) => ({ ...b, title: titles.get(b.id) ?? `#${b.id}` })),
    activities: activityList(),
    ideaBusy: ideaRunning(),
    numbers: {
      visitsToday: today.v, convToday: today.c, visitsTotal: total.v, convTotal: total.c,
      costTodayJpy: Math.round(costToday.s * s.usdJpy), callsToday: costToday.n, costMonthJpy: Math.round(costMonth * s.usdJpy),
      postsToday, live,
    },
    calls: calls.map((c) => ({ id: c.id, at: c.at, purpose: c.purpose, model: label(c.model_id), provider: provider(c.model_id), jpy: c.cost_usd * s.usdJpy, error: c.error, project: c.title })),
    events: events.map((e) => ({ id: e.id, at: e.at, actor: e.actor, kind: e.kind, message: e.message, project: e.title })),
    feed: feed(),
  };
}

export type LiveSnapshot = ReturnType<typeof liveSnapshot>;
