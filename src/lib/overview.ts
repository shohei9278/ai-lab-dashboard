import { db, getSettings, monthAdSpendJpy, monthSpendBreakdownUsd, type ApprovalKind, type EventRow, type ProjectRow, type Stage } from "./db";
import { buildingNow, projectTotals } from "./loop";
import { maskEvents } from "./views";

// ホームの一覧画面（全体の様子）に出す数字をまとめる
// 上の大きな数字とグラフはデモを除いた実データだけ。案件ごとの一覧はデモも出して、印で区別する

export const WAIT_LABEL: Record<ApprovalKind, { title: string; action: string }> = {
  idea: { title: "アイデアの採用", action: "採用するか決める" },
  publish: { title: "LPの公開", action: "公開してよいか決める" },
  decision: { title: "続ける・改善・撤退", action: "次にどうするか決める" },
};

export type WaitItem = {
  key: string;
  projectId: number;
  title: string;
  demo: boolean;
  kind: ApprovalKind | "stuck" | "notify" | "review" | "comment";
  stage: Stage;
  since: string; // UTC の datetime
  daysWaiting: number;
  daysLeft: number | null; // 自動で見送りになるまでの日数
};

const daysSince = (utc: string) => Math.max(0, (Date.now() - Date.parse(utc.replace(" ", "T") + "Z")) / 86_400_000);

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// あなたの承認で止まっているものと、AIの作業が途中で止まっているもの（古い順）
export function waitingItems(): WaitItem[] {
  const s = getSettings();
  const approvals = db()
    .prepare(
      `SELECT a.id, a.kind, a.created_at, p.id AS project_id, p.title, p.demo, p.stage
       FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.status = 'pending' ORDER BY a.created_at, a.id`,
    )
    .all() as { id: number; kind: ApprovalKind; created_at: string; project_id: number; title: string; demo: number; stage: Stage }[];
  const items: WaitItem[] = approvals.map((a) => {
    const d = daysSince(a.created_at);
    return {
      key: `a${a.id}`, projectId: a.project_id, title: a.title, demo: !!a.demo, kind: a.kind, stage: a.stage,
      since: a.created_at, daysWaiting: d, daysLeft: Math.max(0, Math.ceil(s.staleDays - d)),
    };
  });
  // 承認後にAIの呼び出しが失敗して、どこにも進めなくなった案件（案件の画面に「LPを作り直す」が出るもの）
  const stuck = db()
    .prepare(
      `SELECT * FROM projects p WHERE (p.stage = 'idea' OR (p.stage = 'lp' AND p.lp IS NULL))
       AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.project_id = p.id AND a.status = 'pending')`,
    )
    .all() as ProjectRow[];
  for (const p of stuck) {
    if (buildingNow(p.id)) continue; // AIが今まさに作っている
    items.push({
      key: `s${p.id}`, projectId: p.id, title: p.title, demo: !!p.demo, kind: "stuck", stage: p.stage,
      since: p.updated_at, daysWaiting: daysSince(p.updated_at), daysLeft: null,
    });
  }
  // 撤退した案件で、事前登録してくれた人への連絡がまだのもの
  const notify = db().prepare("SELECT * FROM projects WHERE notify_status = 'pending'").all() as ProjectRow[];
  for (const p of notify) {
    items.push({ key: `n${p.id}`, projectId: p.id, title: p.title, demo: !!p.demo, kind: "notify", stage: p.stage, since: p.updated_at, daysWaiting: daysSince(p.updated_at), daysLeft: null });
  }
  // SNSの投稿についたコメントで、返信するか決めていないもの（案件ごとにまとめる）
  const comments = db().prepare("SELECT project_id, COUNT(*) AS n, MIN(fetched_at) AS since FROM sns_comments WHERE status = 'new' GROUP BY project_id").all() as { project_id: number; n: number; since: string }[];
  for (const c of comments) {
    const p = db().prepare("SELECT * FROM projects WHERE id = ?").get(c.project_id) as ProjectRow;
    items.push({ key: `c${p.id}`, projectId: p.id, title: `${p.title}（${c.n}件）`, demo: !!p.demo, kind: "comment", stage: p.stage, since: c.since, daysWaiting: daysSince(c.since), daysLeft: null });
  }
  // 全自動で公開したもので、まだあなたが見ていないもの（止まってはいないが、あとから確認してほしい）
  const unreviewed = db().prepare("SELECT * FROM projects WHERE auto_published = 1 AND human_review IS NULL AND stage NOT IN ('rejected')").all() as ProjectRow[];
  for (const p of unreviewed) {
    items.push({ key: `r${p.id}`, projectId: p.id, title: p.title, demo: !!p.demo, kind: "review", stage: p.stage, since: p.updated_at, daysWaiting: daysSince(p.updated_at), daysLeft: null });
  }
  return items.sort((a, b) => a.since.localeCompare(b.since));
}

export function overview() {
  const s = getSettings();
  const real = db().prepare("SELECT * FROM projects WHERE demo = 0").all() as ProjectRow[];

  // 実データの訪問・登録を日ごとに集計
  const rows = db()
    .prepare(
      `SELECT m.day, SUM(m.visits) AS visits, SUM(m.signups) AS signups, MAX(m.source = 'simulated') AS sim
       FROM metrics m JOIN projects p ON p.id = m.project_id WHERE p.demo = 0 GROUP BY m.day ORDER BY m.day`,
    )
    .all() as { day: string; visits: number; signups: number; sim: number }[];
  let cv = 0;
  let cs = 0;
  const trend = rows.map((r) => {
    cv += r.visits;
    cs += r.signups;
    return { day: r.day.slice(5), visits: cv, signups: cs };
  });
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  const signupsOn = (day: string) => rows.find((r) => r.day === day)?.signups ?? 0;

  const aiRow = db()
    .prepare(
      `SELECT COUNT(*) AS n, SUM(c.at >= datetime('now', 'start of day')) AS today
       FROM ai_calls c LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.error IS NULL AND COALESCE(p.demo, 0) = 0 AND strftime('%Y-%m', c.at) = strftime('%Y-%m', 'now')`,
    )
    .get() as { n: number; today: number | null };

  const spend = monthSpendBreakdownUsd();
  const allProjects = db().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];
  const stageCount = (stages: Stage[]) => allProjects.filter((p) => stages.includes(p.stage)).length;

  const live = allProjects
    .filter((p) => p.stage === "live")
    .map((p) => ({ p, t: projectTotals(p.id) }));
  const improving = allProjects
    .filter((p) => p.improve_count > 0 && !["killed", "rejected"].includes(p.stage))
    .slice(0, 5)
    .map((p) => {
      const note = (db().prepare("SELECT note FROM lp_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1").get(p.id) as { note: string | null } | undefined)?.note;
      return { p, note: note ?? null };
    });

  const events = maskEvents(
    db()
      .prepare("SELECT e.*, p.title, p.demo FROM events e LEFT JOIN projects p ON p.id = e.project_id ORDER BY e.id DESC LIMIT 9")
      .all() as (EventRow & { title: string | null; demo: number | null })[],
  );

  return {
    settings: s,
    todaySignups: signupsOn(localDay(now)),
    yesterdaySignups: signupsOn(localDay(yesterday)),
    totalSignups: cs,
    totalVisits: cv,
    trend,
    trendSimulated: rows.some((r) => r.sim),
    liveReal: real.filter((p) => p.stage === "live").length,
    projectsReal: real.length,
    aiCallsMonth: aiRow.n,
    aiCallsToday: aiRow.today ?? 0,
    aiJpy: spend.total * s.usdJpy,
    adJpy: monthAdSpendJpy(),
    stageCount,
    live,
    improving,
    events,
    allProjects,
  };
}
