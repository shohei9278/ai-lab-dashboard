import { db, type ProjectRow } from "./db";
import { projectTotals } from "./loop";
import { channelSteps, maskChannels, type ChannelRow } from "./channels";

// 案件ごとの「ページの中での動き」。訪問した人が、どこまで進んだか（今の版）
// 人数は訪問者ごと・1日1回で数える（同じ人が別の日に来ると2人と数える。訪問数と同じ数え方）

export type FunnelStep = { key: string; label: string; visitors: number; ofVisits: number | null };
export type Funnel = {
  version: number;
  visits: number;
  steps: FunnelStep[]; // 訪問 → … → 成果
  depth: { percent: number; visitors: number }[]; // どこまで読んだか
  sections: { section: string; visitors: number }[]; // 部品のLPで、各部分が半分見えた人
  errors: number; // 登録に失敗した人
  hasEvents: boolean; // ページの中の動きの記録が届いているか（表を作る前・訪問0のときは false）
};

const SECTION_LABEL: Record<string, string> = { pains: "困りごと", features: "できること", faq: "よくある質問", signup: "登録フォーム" };

// 作った版と、記録がある版のすべて（新しい順）
export function funnelVersions(p: ProjectRow): number[] {
  const rows = db().prepare("SELECT version AS v FROM lp_versions WHERE project_id = ? UNION SELECT lp_version AS v FROM metrics WHERE project_id = ? AND lp_version IS NOT NULL UNION SELECT version AS v FROM lp_funnel WHERE project_id = ?").all(p.id, p.id, p.id) as { v: number }[];
  return [...new Set([...rows.map((r) => r.v), p.public_version ?? p.lp_version])].sort((a, b) => b - a);
}

// version を省くと、いま公開中の版
export function funnel(p: ProjectRow, versionArg?: number): Funnel {
  const version = versionArg ?? p.public_version ?? p.lp_version;
  const t = projectTotals(p.id, version);
  const shares = t.rows.reduce((n, r) => n + (r.shares ?? 0), 0);
  const rows = db().prepare("SELECT name, detail, visitors FROM lp_funnel WHERE project_id = ? AND version = ?").all(p.id, version) as { name: string; detail: string; visitors: number }[];
  const count = (name: string, detail = "") => rows.filter((r) => r.name === name && r.detail === detail).reduce((n, r) => n + r.visitors, 0);
  const depth = [50, 75, 100].map((percent) => ({ percent, visitors: count("scroll_depth", String(percent)) }));
  const of = (n: number) => (t.visits ? n / t.visits : null);
  const half = depth[0].visitors;
  const steps: FunnelStep[] = p.kind === "tool"
    ? [
        // ツールはページの上の方にあるので、読んだ深さは段に入れず、下に別に出す
        { key: "visit", label: "訪問した", visitors: t.visits, ofVisits: of(t.visits) },
        { key: "tool_view", label: "ツールが画面に入った", visitors: count("section_view", "tool"), ofVisits: of(count("section_view", "tool")) },
        { key: "use", label: "ツールを操作した", visitors: t.signups, ofVisits: of(t.signups) },
        { key: "share", label: "シェアした", visitors: shares, ofVisits: of(shares) },
      ]
    : [
        { key: "visit", label: "訪問した", visitors: t.visits, ofVisits: of(t.visits) },
        { key: "half", label: "ページの半分まで読んだ", visitors: half, ofVisits: of(half) },
        { key: "cta", label: "登録ボタンを押した", visitors: count("cta_click"), ofVisits: of(count("cta_click")) },
        { key: "form", label: "メール欄に入力を始めた", visitors: count("form_start"), ofVisits: of(count("form_start")) },
        { key: "signup", label: "事前登録した", visitors: t.signups, ofVisits: of(t.signups) },
      ];
  const sections = Object.keys(SECTION_LABEL).map((k) => ({ section: SECTION_LABEL[k], visitors: count("section_view", k) })).filter((x) => x.visitors > 0);
  return { version, visits: t.visits, steps, depth, sections, errors: count("sign_up_error"), hasEvents: rows.length > 0 };
}

// AIの判断に渡す文
export function funnelText(p: ProjectRow): string {
  const f = funnel(p);
  if (!f.hasEvents || !f.visits) return "";
  const pc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  return `ページの中での動き（第${f.version}版・訪問者に対する割合）: ${f.steps.map((s) => `${s.label} ${s.visitors}人（${pc(s.ofVisits)}）`).join(" → ")}
読んだ深さ: ${f.depth.map((d) => `${d.percent}%まで ${d.visitors}人`).join(" / ")}${f.errors ? ` / 登録の失敗 ${f.errors}人` : ""}${channelText(p, f.version)}`;
}

// 流入元ごとに、どこまで進んだか（件数が少ないうちは偶然の差が大きい）
function channelText(p: ProjectRow, version: number): string {
  const rows = channelRows(p.id, version, false);
  if (!rows.length) return "";
  const steps = channelSteps(p.kind === "tool");
  return `\n流入元ごと（件数が少ないうちは偶然の差が大きい）: ${rows.map((r) => `${r.label} ${r.visitors}人（${steps.map((s) => `${s.label} ${r.steps[s.key] ?? 0}人`).join("・")}）`).join(" / ")}`;
}

// 流入元ごとの人数（来訪者には、ほかのサイトの名前をまとめて出す）
export function channelRows(projectId: number, version: number, owner: boolean): ChannelRow[] {
  const row = db().prepare("SELECT data FROM lp_channels WHERE project_id = ? AND version = ?").get(projectId, version) as { data: string } | undefined;
  const rows = row ? (JSON.parse(row.data) as ChannelRow[]) : [];
  return owner ? rows : maskChannels(rows);
}
