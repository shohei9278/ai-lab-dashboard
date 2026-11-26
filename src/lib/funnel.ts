import { db, type ProjectRow } from "./db";
import { logEvent, projectTotals } from "./loop";
import { channelSteps, maskChannels, type ChannelRow } from "./channels";
import { PLAY_TIME_MARKS, RESULT_MARKS, depthValueOk } from "../../lp-site/src/lp/playDepth";
import { parseToolError } from "../../lp-site/src/lp/toolErrors";

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
  toolErrors: ToolError[]; // 来た人の画面で、ツールの中で起きたエラー（動くツールだけ。人の多い順）
};

// 本番で来た人の画面で、ツールの中で起きたエラー（種類と行の番号。人数は訪問者ごと・1日1回）
export type ToolError = { name: string; line: number | null; visitors: number };
export function toolErrors(rows: { name: string; detail: string; visitors: number }[]): ToolError[] {
  const by = new Map<string, ToolError>();
  for (const r of rows) {
    if (r.name !== "tool_error") continue;
    const e = parseToolError(r.detail);
    if (!e) continue;
    const k = `${e.name}|${e.line}`;
    const x = by.get(k) ?? { ...e, visitors: 0 };
    x.visitors += r.visitors;
    by.set(k, x);
  }
  return [...by.values()].sort((a, b) => b.visitors - a.visitors || (a.line ?? 0) - (b.line ?? 0));
}
export const toolErrorLabel = (e: ToolError) => `${e.name}${e.line ? `（${e.line}行目）` : ""}`;

// 取り込みのたびに呼ぶ。公開中の版で、エラーが起きた人が前に知らせたときより増えていたら、経過に残して知らせる（-error の通知。同じ種類は1時間に1回まで）
export function checkToolErrors(p: ProjectRow): void {
  if (p.kind !== "tool") return;
  const v = p.public_version ?? p.lp_version;
  const errs = toolErrors(db().prepare("SELECT name, detail, visitors FROM lp_funnel WHERE project_id = ? AND version = ? AND name = 'tool_error'").all(p.id, v) as { name: string; detail: string; visitors: number }[]);
  const n = errs.reduce((a, e) => a + e.visitors, 0);
  let seen = { v: 0, n: 0 };
  try { if (p.tool_errors_seen) seen = JSON.parse(p.tool_errors_seen) as { v: number; n: number }; } catch {}
  if (n <= (seen.v === v ? seen.n : 0)) return;
  db().prepare("UPDATE projects SET tool_errors_seen = ? WHERE id = ?").run(JSON.stringify({ v, n }), p.id);
  logEvent(p.id, "system", "tool-runtime-error", `公開中の第${v}版のツールで、来た人の画面でエラーが起きました（のべ${n}人: ${errs.slice(0, 3).map((e) => `${toolErrorLabel(e)} ${e.visitors}人`).join("・")}）`);
}

// 遊びの深さ: 来た人1人あたり、どれだけ遊んだか（来た人数に左右されない、面白さの目安）
// AIの判断の材料には、案件のねらいに合わせた見方と一緒に渡す（playText。11/26 に運営者が決めた）。当たりの判定（hits.ts）には、まだ使わない
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
  return { version, visits: t.visits, steps, depth, sections, errors: count("sign_up_error"), hasEvents: rows.some((r) => r.name !== "revisit"), play: p.kind === "tool" ? playDepth(rows) : null, toolErrors: p.kind === "tool" ? toolErrors(rows) : [] };
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

// 遊び始めた人がこれより少ないうちは、割合の差を信じすぎないよう書き添える
export const PLAY_FEW_USERS = 20;

// ねらいごとの、遊びの深さの見方（一律に「長く遊ばせる」方向へ直させない。役に立つツールは、すぐ用が済むのも良い結果）
export function playLens(aim: string | null): string {
  if (aim === "spread") return "ねらいは「広がる」: 触ったあとも遊び続けたか（60秒以上）と、結果を何回も出したか（2回以上）を良い結果として見る。シェアの数も合わせて見る";
  if (aim === "return") return "ねらいは「また来てもらう」: 別の日にまた来た人をいちばん重く見る。1回の遊んだ時間は参考にとどめる";
  if (aim === "useful") return "ねらいは「役に立つ」: 目的の操作まで行けたか（ツールを操作した人）を見る。短い時間で終わるのは、すぐ用が済んだということで悪くない。遊んだ時間や結果を出した回数を増やすための変更はしない";
  return "ねらいが決まっていない案件: 遊んだ時間の長さだけで良し悪しを決めない";
}

// AIの判断に渡す、遊びの深さ（動くツールで、記録が届いているときだけ）。人数と、遊び始めた人に対する割合を並べる（再訪は人数だけ）
export function playText(p: Pick<ProjectRow, "kind" | "aim">, d: PlayDepth | null): string {
  if (p.kind !== "tool" || !d || (!d.hasData && !d.revisit)) return "";
  const pc = (n: number) => (d.users ? `${Math.round((n / d.users) * 100)}%` : "—");
  const time = d.time.filter((x) => x.visitors > 0).map((x) => `${x.mark < 60 ? `${x.mark}秒` : `${x.mark / 60}分`}以上 ${x.visitors}人（${pc(x.visitors)}）`).join("・");
  const results = d.results.filter((x) => x.visitors > 0).map((x) => `${x.mark}回以上 ${x.visitors}人（${pc(x.visitors)}）`).join("・");
  const kinds = d.kinds.filter((x) => x.visitors > 0).map((x) => `${x.mark}種類以上 ${x.visitors}人（${pc(x.visitors)}）`).join("・");
  const parts = [
    `遊び始めた ${d.users}人`,
    time ? `遊んだ時間: ${time}` : "",
    results ? `結果を出した回数: ${results}` : "",
    kinds ? `出した結果の種類: ${kinds}` : "",
    // 再訪は人数だけ。遊ばずにページだけ見た人も入るので、遊び始めた人で割ると意味がずれる（PR #207 の ai-review の指摘に、運営者が決めた）
    `別の日にまた来た ${d.revisit}人`,
  ].filter(Boolean);
  const few = d.users < PLAY_FEW_USERS ? `（遊び始めた人が${PLAY_FEW_USERS}人未満のうちは、割合の差は偶然の可能性が高い）` : "";
  return `\n遊びの深さ（今の版。割合は遊び始めた人に対して）: ${parts.join(" / ")}${few}\n見方: ${playLens(p.aim)}`;
}

// AIの判断に渡す文
export function funnelText(p: ProjectRow): string {
  const f = funnel(p);
  // 直したばかりで今の版に訪問がないときも、前の版の数字は渡す（直す前がどうだったかを見失わないように）
  if (!f.visits) { const prev = previousText(p, f.version); return prev ? `今の版（第${f.version}版）はまだ訪問なし${prev}` : ""; }
  const pc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  // 流入元は訪問の記録から数えるので、ページの中での動きの記録がない版でも渡す
  const channels = channelText(p, f.version).trim();
  // 来た人の画面で起きたツールのエラーは、AIの判断にも渡す（遊べていないかもしれないため）
  const errs = f.toolErrors.length ? `\n来た人の画面で起きたツールのエラー: ${f.toolErrors.slice(0, 5).map((e) => `${toolErrorLabel(e)} ${e.visitors}人`).join(" / ")}` : "";
  const prev = previousText(p, f.version);
  // 遊びの深さ（遊んだ時間・結果を出した回数・再訪）は、ねらいに合わせた見方と一緒に渡す
  const play = playText(p, f.play);
  if (!f.hasEvents) return `${channels}${play}${errs}${prev}`.trim();
  return `ページの中での動き（第${f.version}版・訪問者に対する割合）: ${f.steps.map((s) => `${s.label} ${s.visitors}人（${pc(s.ofVisits)}）`).join(" → ")}
読んだ深さ: ${f.depth.map((d) => `${d.percent}%まで ${d.visitors}人`).join(" / ")}${f.errors ? ` / 登録の失敗 ${f.errors}人` : ""}${channels ? `\n${channels}` : ""}${play}${errs}${prev}`;
}

// 前の版との比べ: ページを直して新しい版になると、新しい版の少ない数字しか見えず、直しが効いたかを比べられなかった（運営者が、毎日の直しが過去に基づいているかを尋ね、足すと決めた）
// 今の版より前で、訪問のあるいちばん新しい版の動きと、今の版で変えたこと（版のメモ）を並べる
export function previousText(p: ProjectRow, version: number): string {
  const pc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const prev = funnelVersions(p).filter((v) => v < version).map((v) => funnel(p, v)).find((f) => f.visits > 0);
  if (!prev) return "";
  const note = (db().prepare("SELECT note FROM lp_versions WHERE project_id = ? AND version = ?").get(p.id, version) as { note: string | null } | undefined)?.note;
  const steps = prev.hasEvents ? `: ${prev.steps.map((s) => `${s.label} ${s.visitors}人（${pc(s.ofVisits)}）`).join(" → ")}` : "";
  return `\n前の版（第${prev.version}版・訪問${prev.visits}人）${steps}${note ? `\n第${version}版で変えたこと: ${note.replace(/\s+/g, " ").slice(0, 120)}` : ""}\n（版ごとの人数が少ないうちは、差は偶然の可能性が高い）`;
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
