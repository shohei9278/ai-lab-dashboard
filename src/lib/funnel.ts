import { db, type ProjectRow } from "./db";
import { projectTotals } from "./loop";
import { channelSteps, maskChannels, type ChannelRow } from "./channels";
import { PLAY_TIME_MARKS, RESULT_MARKS, depthValueOk } from "../../lp-site/src/lp/playDepth";

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
  play: PlayDepth | null; // 遊びの深さ（動くツールだけ）
};

// 遊びの深さ: 来た人1人あたり、どれだけ遊んだか（来た人数に左右されない、面白さの目安。まずは見るだけで、当たりの判定やAIの判断には使わない）
// 公開サイトが、遊んだ時間・結果を出した回数・結果の種類が決まった区切りを超えたときに記録する（lp-site/src/lp/playDepth.ts）
// 人数は、ほかの段と同じく訪問者ごと・1日1回で数える
export type PlayDepth = {
  users: number; // 遊び始めた人（枠の中で初めて触った・押した・振った人。割合の分母）
  time: { mark: number; visitors: number }[]; // その秒数以上遊んだ人
  halfTime: number | null; // 遊び始めた人の半分以上が遊んだ秒数（区切りの中でいちばん長いもの。15秒に届かなければ null）
  results: { mark: number; visitors: number }[]; // 結果をその回数以上出した人（1回目は「操作した」とほぼ同じなので2回から）
  kinds: { mark: number; visitors: number }[]; // 結果をその種類以上出した人（結果の種類が決まっているツールだけ）
  revisit: number; // この版に、別の日にまた来た人
  hasData: boolean; // 遊びの深さの記録が届いているか
};
// 遊び始めた人は、遊んだ時間の 0秒 として記録する（lp-site/src/lp/playDepth.ts）
const PLAY_START = "0";



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
  return { version, visits: t.visits, steps, depth, sections, errors: count("sign_up_error"), hasEvents: rows.some((r) => r.name !== "revisit"), play: p.kind === "tool" ? playDepth(rows) : null };
}

export function playDepth(all: { name: string; detail: string; visitors: number }[]): PlayDepth {
  const rows = all.filter((r) => depthValueOk(r.name, r.detail)); // ありえない値は外す（前に送り込まれた記録にも耐える）
  const count = (name: string, detail: string) => rows.filter((r) => r.name === name && r.detail === detail).reduce((n, r) => n + r.visitors, 0);
  const users = count("play_time", PLAY_START);
  const time = PLAY_TIME_MARKS.map((mark) => ({ mark, visitors: count("play_time", String(mark)) }));
  const kindMarks = [...new Set(rows.filter((r) => r.name === "result_kinds").map((r) => Number(r.detail)).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const reached = time.filter((x) => users > 0 && x.visitors * 2 >= users);
  return {
    users,
    time,
    halfTime: reached.length ? reached[reached.length - 1].mark : null,
    results: RESULT_MARKS.map((mark) => ({ mark, visitors: count("results", String(mark)) })),
    kinds: kindMarks.map((mark) => ({ mark, visitors: count("result_kinds", String(mark)) })),
    revisit: count("revisit", ""),
    hasData: rows.some((r) => r.name === "play_time" || r.name === "results" || r.name === "result_kinds"),
  };
}

// AIの判断に渡す文
export function funnelText(p: ProjectRow): string {
  const f = funnel(p);
  if (!f.visits) return "";
  const pc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  // 流入元は訪問の記録から数えるので、ページの中での動きの記録がない版でも渡す
  const channels = channelText(p, f.version).trim();
  if (!f.hasEvents) return channels;
  return `ページの中での動き（第${f.version}版・訪問者に対する割合）: ${f.steps.map((s) => `${s.label} ${s.visitors}人（${pc(s.ofVisits)}）`).join(" → ")}
読んだ深さ: ${f.depth.map((d) => `${d.percent}%まで ${d.visitors}人`).join(" / ")}${f.errors ? ` / 登録の失敗 ${f.errors}人` : ""}${channels ? `\n${channels}` : ""}`;
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
