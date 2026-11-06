import { db } from "./db";
import { BOTTLENECK_LABEL, planProgress, type PlanRow } from "./plan";
import type { DebateResult } from "./loop";
import { modelInfo } from "./models";
import type { AdhocContent } from "./adhoc";

// 会議室: AIの社員どうしのやり取りを「議事録」として並べる。新しくAIを呼ばず、今あるデータから作る
// - アイデア会議（3社が案を出し、作者を伏せて採点し合う）
// - 文章と構成の会議・デザインの会議（作り比べと採点）
// - 判断の会議（撤退・継続などで意見が分かれたときの議論）
// - 朝会（毎朝の計画。日替わりの担当）
// - 週の定例会議（3社が振り返り、改善案を出し合って採点する）

export type MeetingKind = "adhoc" | "idea" | "copy" | "design" | "judge" | "plan" | "weekly";
export const MEETING_LABEL: Record<MeetingKind, string> = {
  adhoc: "臨時会議（あなたの議題）", idea: "アイデア会議", copy: "文章と構成の会議", design: "デザインの会議", judge: "判断の会議", plan: "朝会（今日の計画）", weekly: "週の定例会議",
};

export type MeetingItem = { who: string | null; title: string; text?: string; score?: number | null; won?: boolean; scores?: { who: string; score: number; reason?: string }[] };
export type FollowUp = {
  split: NonNullable<AdhocContent["split"]>;
  dueAt: string; // 振り返る日（日本時間の YYYY-MM-DD）
  due: boolean;
  before: { days: number; visits: number; conversions: number }; // 会議の前の7日
  after: { days: number; visits: number; conversions: number }; // 会議のあと（振り返る日まで）
  actions: { title: string; status: string }[]; // 会議で決めたことを、実際にやったか
  revisit?: AdhocContent["revisit"];
};
export type Meeting = {
  key: string; kind: MeetingKind; at: string; title: string; attendees: string[]; conclusion: string;
  items: MeetingItem[]; projectId?: number | null; hiddenAuthors?: boolean; followUp?: FollowUp;
};

const jday = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);

// 会議の前後の数字（全案件の訪問・登録/利用の合計。デモ・仮の数字は除く）
function windowTotals(from: string, to: string): { days: number; visits: number; conversions: number } {
  const r = db().prepare(
    "SELECT COALESCE(SUM(m.visits), 0) AS v, COALESCE(SUM(m.signups), 0) AS c FROM metrics m JOIN projects p ON p.id = m.project_id WHERE p.demo = 0 AND m.source != 'simulated' AND m.day >= ? AND m.day < ?",
  ).get(from, to) as { v: number; c: number };
  const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
  return { days, visits: r.v, conversions: r.c };
}

export function followUpOf(id: number, at: string, c: AdhocContent): FollowUp | undefined {
  if (!c.split) return undefined;
  const start = jday(new Date(Date.parse(at.replace(" ", "T") + "Z")));
  const dueAt = jday(new Date(Date.parse(`${start}T00:00:00+09:00`) + c.split.checkAfterDays * 86_400_000));
  const today = jday(new Date());
  const end = today < dueAt ? today : dueAt;
  const acts = db().prepare("SELECT title, status FROM plan_requests WHERE meeting_id = ?").all(id) as { title: string; status: string }[];
  return {
    split: c.split, dueAt, due: today >= dueAt,
    before: windowTotals(jday(new Date(Date.parse(`${start}T00:00:00+09:00`) - 7 * 86_400_000)), start),
    after: windowTotals(start, end),
    actions: acts.map((a) => ({ title: a.title, status: a.status === "done" ? "やった" : a.status === "declined" ? "見送り" : "返事待ち" })),
    revisit: c.revisit,
  };
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const since = (days: number) => `-${days} days`;

function ideaMeetings(days: number): Meeting[] {
  const rows = db().prepare("SELECT * FROM idea_candidates WHERE practice = 0 AND at >= datetime('now', ?) ORDER BY id").all(since(days)) as
    { id: number; at: string; batch_id: string; label: string; author_model: string; title: string; payload: string; avg_score: number | null; selected: number }[];
  const scores = db().prepare("SELECT candidate_id, scorer_model, score, reason FROM idea_scores WHERE candidate_id IN (SELECT id FROM idea_candidates WHERE at >= datetime('now', ?))").all(since(days)) as
    { candidate_id: number; scorer_model: string; score: number; reason: string | null }[];
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.batch_id, [...(by.get(r.batch_id) ?? []), r]);
  return [...by].map(([batch, list]) => {
    const items = list.map((c) => {
      const idea = JSON.parse(c.payload) as { target?: string; problem?: string };
      return {
        who: c.author_model, title: `案${c.label}「${c.title}」`, text: [idea.target && `対象: ${idea.target}`, idea.problem && `困りごと: ${idea.problem}`].filter(Boolean).join(" / "),
        score: c.avg_score, won: !!c.selected,
        scores: scores.filter((s) => s.candidate_id === c.id).map((s) => ({ who: s.scorer_model, score: s.score, reason: s.reason ?? undefined })),
      };
    }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const won = list.filter((c) => c.selected).map((c) => `「${c.title}」`);
    return {
      key: `idea-${batch}`, kind: "idea" as const, at: list[0].at, title: `アイデア会議（${list.length}案）`,
      attendees: uniq([...list.map((c) => c.author_model), ...items.flatMap((i) => i.scores.map((s) => s.who))]),
      conclusion: won.length ? `${won.join("・")}を案件にすることに決定` : "どの案も見送り", items,
    };
  });
}

function copyMeetings(days: number): Meeting[] {
  const rows = db().prepare(
    `SELECT c.*, p.title AS ptitle FROM lp_candidates c JOIN projects p ON p.id = c.project_id WHERE p.demo = 0 AND c.at >= datetime('now', ?) ORDER BY c.id`,
  ).all(since(days)) as { id: number; at: string; project_id: number; version: number; label: string; author_model: string; lp: string; avg_score: number | null; selected: number; ptitle: string }[];
  const scores = db().prepare("SELECT candidate_id, scorer_model, score, reason FROM lp_candidate_scores WHERE candidate_id IN (SELECT id FROM lp_candidates WHERE at >= datetime('now', ?))").all(since(days)) as
    { candidate_id: number; scorer_model: string; score: number; reason: string | null }[];
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(`${r.project_id}-${r.version}`, [...(by.get(`${r.project_id}-${r.version}`) ?? []), r]);
  return [...by].map(([k, list]) => {
    // 公開の判断がまだのあいだは、案件の画面と同じく作者を伏せる
    const hidden = !!db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND kind = 'publish' AND status = 'pending'").get(list[0].project_id);
    const items = list.map((c) => ({
      who: hidden ? null : c.author_model, title: `案${c.label}「${(JSON.parse(c.lp) as { headline?: string }).headline ?? ""}」`,
      score: c.avg_score, won: !!c.selected,
      scores: scores.filter((s) => s.candidate_id === c.id).map((s) => ({ who: s.scorer_model, score: s.score, reason: s.reason ?? undefined })),
    })).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const win = list.find((c) => c.selected);
    return {
      key: `copy-${k}`, kind: "copy" as const, at: list[0].at, title: `${list[0].ptitle}（第${list[0].version}版）`, projectId: list[0].project_id, hiddenAuthors: hidden,
      attendees: uniq([...(hidden ? [] : list.map((c) => c.author_model)), ...items.flatMap((i) => i.scores.map((s) => s.who))]),
      conclusion: win ? `案${win.label}に決定（平均 ${win.avg_score?.toFixed(1) ?? "—"}点）` : "決まらず", items,
    };
  });
}

function designMeetings(days: number): Meeting[] {
  const rows = db().prepare(
    `SELECT c.*, p.title AS ptitle FROM page_candidates c JOIN projects p ON p.id = c.project_id WHERE p.demo = 0 AND c.model IS NOT NULL AND c.at >= datetime('now', ?) ORDER BY c.id`,
  ).all(since(days)) as { id: number; at: string; project_id: number; version: number; model: string; score: number | null; reason: string | null; selected: number; judges: string | null; ptitle: string }[];
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(`${r.project_id}-${r.version}`, [...(by.get(`${r.project_id}-${r.version}`) ?? []), r]);
  return [...by].filter(([, l]) => l.length === 2).map(([k, list]) => {
    const judges = list[0].judges ? (JSON.parse(list[0].judges) as { modelId: string; a: number; b: number; reason: string }[]) : [];
    const items = list.map((c, i) => ({
      who: c.model, title: "ページのデザイン案", score: c.score, won: !!c.selected,
      scores: judges.map((j) => ({ who: j.modelId, score: i === 0 ? j.a : j.b, reason: j.reason })),
    }));
    const win = list.find((c) => c.selected);
    return {
      key: `design-${k}`, kind: "design" as const, at: list[0].at, title: `${list[0].ptitle}（第${list[0].version}版）`, projectId: list[0].project_id,
      attendees: uniq([...list.map((c) => c.model), ...judges.map((j) => j.modelId)]),
      conclusion: win ? `${modelInfo(win.model).label}の案に決定（3社の採点の平均 ${win.score?.toFixed(1) ?? "—"}点）` : "決まらず", items,
    };
  });
}

function judgeMeetings(days: number): Meeting[] {
  const rows = db().prepare(
    `SELECT d.id, d.at, d.status, d.payload, a.project_id, p.title AS ptitle FROM debates d JOIN approvals a ON a.id = d.approval_id JOIN projects p ON p.id = a.project_id
     WHERE d.payload IS NOT NULL AND d.at >= datetime('now', ?) ORDER BY d.id`,
  ).all(since(days)) as { id: number; at: string; status: string; payload: string; project_id: number; ptitle: string }[];
  const DEC: Record<string, string> = { continue: "続ける", improve: "改善", kill: "撤退", collect: "データを集める", rethink: "集客を見直す" };
  return rows.map((r) => {
    const d = JSON.parse(r.payload) as DebateResult;
    return {
      key: `judge-${r.id}`, kind: "judge" as const, at: r.at, title: r.ptitle, projectId: r.project_id,
      attendees: uniq(d.positions.map((p) => p.modelId)),
      conclusion: `争点: ${d.issue}`,
      items: d.positions.map((p) => ({ who: p.modelId, title: `最初は「${DEC[p.first] ?? p.first}」→ 最後は「${DEC[p.final] ?? p.final}」` })),
    };
  });
}

function planMeetings(days: number): Meeting[] {
  const rows = db().prepare("SELECT * FROM daily_plans WHERE created_at >= datetime('now', ?) ORDER BY id").all(since(days)) as PlanRow[];
  return rows.map((p) => {
    const g = planProgress(p);
    return {
      key: `plan-${p.id}`, kind: "plan" as const, at: p.created_at, title: `${p.day.slice(5).replace("-", "/")}の朝会`,
      attendees: [p.model_id],
      conclusion: `ネック「${BOTTLENECK_LABEL[g.content.bottleneck].split("（")[0]}」: ${g.content.focus}（予定 ${g.done}/${g.total}件 済み）`,
      items: [{ who: p.model_id, title: "振り返り", text: g.content.review }],
    };
  });
}

export type WeeklyContent = {
  members: { modelId: string; review: string; proposals: { title: string; how: string; why: string; target: "human" | "system" }[] }[];
  ranked: { title: string; proposer: string; score: number; scores: { who: string; score: number }[] }[];
  summary: string; chair: string;
};
export type WeeklyRow = { id: number; at: string; period_start: string; period_end: string; chair_model: string; content: string; report_id: number | null };

function weeklyMeetings(days: number): Meeting[] {
  const rows = db().prepare("SELECT * FROM meetings WHERE kind = 'weekly' AND at >= datetime('now', ?) ORDER BY id").all(since(days)) as WeeklyRow[];
  return rows.map((r) => {
    const c = JSON.parse(r.content) as WeeklyContent;
    return {
      key: `meeting-${r.id}`, kind: "weekly" as const, at: r.at, title: `${r.period_start.slice(5).replace("-", "/")}〜${r.period_end.slice(5).replace("-", "/")} の定例会議`,
      attendees: uniq(c.members.map((m) => m.modelId)),
      conclusion: c.summary,
      items: [
        ...c.members.map((m) => ({ who: m.modelId, title: "振り返り", text: m.review })),
        ...c.ranked.map((p, i) => ({ who: p.proposer, title: `提案「${p.title}」`, score: p.score, won: i < 3, scores: p.scores })),
      ],
    };
  });
}

function adhocMeetings(days: number): Meeting[] {
  const rows = db().prepare("SELECT * FROM meetings WHERE kind = 'adhoc' AND at >= datetime('now', ?) ORDER BY id").all(since(days)) as WeeklyRow[];
  return rows.map((r) => {
    const c = JSON.parse(r.content) as AdhocContent;
    return {
      key: `meeting-${r.id}`, kind: "adhoc" as const, at: r.at, title: `議題「${c.topic}」`, followUp: followUpOf(r.id, r.at, c),
      attendees: uniq(c.rounds.map((x) => x.modelId)),
      conclusion: `${c.conclusion}（議長 ${modelInfo(c.chair).label}）`,
      items: [
        ...c.rounds.map((x) => ({ who: x.modelId, title: x.changed ? "意見（議論のあと考えを変えた）" : "意見", text: `最初: ${x.opinion}${x.final ? `\n最後: ${x.final}` : ""}` })),
        ...c.actions.map((a) => ({ who: c.chair, title: `やること「${a.title}」（${a.target === "human" ? "運営者" : "仕組み"}）→ 提案箱へ`, text: a.how })),
      ],
    };
  });
}

export function listMeetings(kind?: MeetingKind, days = 30): Meeting[] {
  const all: Record<MeetingKind, () => Meeting[]> = {
    adhoc: () => adhocMeetings(days),
    idea: () => ideaMeetings(days), copy: () => copyMeetings(days), design: () => designMeetings(days),
    judge: () => judgeMeetings(days), plan: () => planMeetings(days), weekly: () => weeklyMeetings(days),
  };
  const kinds = kind ? [kind] : (Object.keys(all) as MeetingKind[]);
  return kinds.flatMap((k) => all[k]()).sort((a, b) => b.at.localeCompare(a.at));
}
