import { callJson, isObj, isStr } from "./ai";
import { db, getSettings } from "./db";
import { TOOL_DATA_MAX, TOOL_DATA_ROWS_MAX } from "../../lp-site/src/lp/content";

// じっくり案件: 大きなデータ・Google Fonts・見た目を磨く段を使ってよい、時間とお金をかける枠
// データはAIが下書きし、人が確かめてからツールに渡す（このファイルは下書きを作るところまで。流れは loop.ts）

// key: データの1件の中の名前（英数字）/ label: 人が読む名前
// kind: fact = 確かめられる事実（地名・公式の数など）/ view = 遊びのための見立て（性格との結びつきなど）
export type DeepField = { key: string; label: string; kind: "fact" | "view" };
export type DeepSpec = { fields: DeepField[]; groups: string[]; per_group: string; note: string };
export type DeepRow = Record<string, string | number | boolean>;

export const DEEP_GROUP_MAX = 60; // グループの数の上限（グループごとにAIを1回呼ぶ）
export const DEEP_ROWS_PER_GROUP = 60; // 1つのグループで出す件数の上限（出力が途中で切れないように）
const PARALLEL = 6;

// 直近7日に作ったじっくり案件の数から、あと何件作ってよいか
export function deepAllowance(s = getSettings()): number {
  const n = (db().prepare("SELECT COUNT(*) AS n FROM projects WHERE deep = 1 AND demo = 0 AND created_at >= datetime('now', '-7 days')").get() as { n: number }).n;
  return Math.max(0, s.deepPerWeek - n);
}

// 人が確かめるときに見せる例。偏らないように、全体から等間隔に取る
export function sampleRows<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  const step = rows.length / n;
  return Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)]);
}

const KEY = /^[a-z][a-z0-9_]{0,30}$/;
export function isDeepSpec(v: unknown): v is DeepSpec {
  return isObj(v) && Array.isArray(v.fields) && v.fields.length >= 1 && v.fields.length <= 12
    && v.fields.every((f) => isObj(f) && isStr(f.key) && KEY.test(f.key) && isStr(f.label) && (f.kind === "fact" || f.kind === "view"))
    && new Set(v.fields.map((f) => (f as DeepField).key)).size === v.fields.length
    && Array.isArray(v.groups) && v.groups.length >= 1 && v.groups.length <= DEEP_GROUP_MAX && v.groups.every(isStr)
    && isStr(v.per_group) && isStr(v.note);
}

// AIが出した1グループ分の行から、決めた項目がそろったものだけを残す（値は文字・数・真偽だけ。長すぎる文字は切る）
export function cleanRows(raw: unknown, fields: DeepField[]): DeepRow[] {
  if (!Array.isArray(raw)) return [];
  const out: DeepRow[] = [];
  for (const r of raw.slice(0, DEEP_ROWS_PER_GROUP)) {
    if (!isObj(r)) continue;
    const row: DeepRow = {};
    let ok = true;
    for (const f of fields) {
      const v = r[f.key];
      if (typeof v === "string" && v.trim()) row[f.key] = v.trim().slice(0, 200);
      else if (typeof v === "number" && Number.isFinite(v)) row[f.key] = v;
      else if (typeof v === "boolean") row[f.key] = v;
      else { ok = false; break; }
    }
    if (ok) out.push(row);
  }
  return out;
}

// 全体の件数と大きさを上限に収め、同じ行（全項目が同じ）を除く
export function capRows(rows: DeepRow[]): DeepRow[] {
  const seen = new Set<string>();
  const out: DeepRow[] = [];
  let size = 2;
  for (const r of rows) {
    const s = JSON.stringify(r);
    if (seen.has(s)) continue;
    if (out.length >= TOOL_DATA_ROWS_MAX || size + s.length + 1 > TOOL_DATA_MAX) break;
    seen.add(s);
    out.push(r);
    size += s.length + 1;
  }
  return out;
}

const RULES = `守ること:
- 事実（kind: fact）の項目には、実在すると確信できるものだけを書く。地名・名称は正式な表記にする。分からないもの・自信がないものは入れない（件数が減ってもよい）
- 見立て（kind: view）の項目は、遊びのための主観の見立てであり、事実のように書かない。特定の地域・人・団体をおとしめる見立てはしない
- 個人の名前・連絡先など、個人を特定できる情報は入れない`;

// じっくり案件のデータの下書きを作る: まず項目とグループの設計を決め、グループごとに中身を作る
// comment: 人の修正指示（作り直すとき）。prev: 前の設計（作り直すときに、直す所だけ変えるため）
export async function draftDeepData(p: { id: number; title: string; target: string; solution: string; deep_need: string | null }, comment?: string, prev?: DeepSpec): Promise<{ spec: DeepSpec; rows: DeepRow[] }> {
  const spec = await callJson<DeepSpec>({
    purpose: "じっくり案件のデータの設計",
    projectId: p.id,
    system: `あなたはWebツールで使うデータを設計する担当です。ツールが読む1つの一覧（配列）の、1件ごとの項目と、作るときの分け方（グループ）を決めます。
- 項目は12個まで。key は英小文字・数字・_ だけ。ツールの機能に要るものだけにする
- グループは、一覧を${DEEP_GROUP_MAX}個までに分けたもの（例: 都道府県ごと）。1つのグループに入る件数が${DEEP_ROWS_PER_GROUP}件を超えないように分ける（大きい所は「北海道（道央）」のようにさらに分ける）
- 全体で${TOOL_DATA_ROWS_MAX}件まで
${RULES}
形式: {"fields":[{"key":"name","label":"市町村名","kind":"fact"},{"key":"mood","label":"町の雰囲気（見立て）","kind":"view"}],"groups":["北海道（道央）","青森県"],"per_group":"各グループで1件ずつ出すもの（例: そのグループの全市町村）","note":"このデータの説明。どこが事実で、どこが見立てか"}`,
    user: `ツール名: ${p.title}\n対象: ${p.target}\n何ができるツールか: ${p.solution}\n要るデータ（アイデアに書かれたもの）: ${p.deep_need ?? "（書かれていない）"}${prev ? `\n\n前の設計:\n${JSON.stringify(prev)}` : ""}${comment ? `\n\n人の修正指示: ${comment}` : ""}`,
    validate: isDeepSpec,
  });

  const rows: DeepRow[][] = Array.from({ length: spec.groups.length }, () => []);
  const failed: string[] = [];
  const keys = spec.fields.map((f) => `${f.key}（${f.label}・${f.kind === "fact" ? "事実" : "見立て"}）`).join(" / ");
  for (let i = 0; i < spec.groups.length; i += PARALLEL) {
    await Promise.all(spec.groups.slice(i, i + PARALLEL).map(async (group, j) => {
      try {
        const out = await callJson<{ rows: unknown[] }>({
          purpose: "じっくり案件のデータの下書き",
          projectId: p.id,
          system: `あなたはWebツールで使うデータを作る担当です。決められた項目で、指定されたグループの分だけを作ります。
- 1件ごとに、すべての項目を埋める（値は文字・数・真偽のどれか）
- このグループの分は${DEEP_ROWS_PER_GROUP}件まで
${RULES}
形式: {"rows":[{"項目のkey":"値"}]}`,
          user: `ツール名: ${p.title}\nデータの説明: ${spec.note}\n項目: ${keys}\n各グループで出すもの: ${spec.per_group}\n今回のグループ: ${group}${comment ? `\n\n人の修正指示: ${comment}` : ""}`,
          validate: (v): v is { rows: unknown[] } => isObj(v) && Array.isArray(v.rows),
        });
        rows[i + j] = cleanRows(out.rows, spec.fields);
      } catch {
        failed.push(group);
      }
    }));
  }
  const all = capRows(rows.flat());
  if (!all.length) throw new Error("データの下書きを1件も作れませんでした");
  if (failed.length) spec.note = `${spec.note}（作れなかったグループ: ${failed.slice(0, 10).join("・")}${failed.length > 10 ? ` ほか${failed.length - 10}件` : ""}）`;
  return { spec, rows: all };
}
