import { callJson, isObj, isStr } from "./ai";
import { autoSettings } from "./autopilot";
import { db } from "./db";
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
export function deepAllowance(s = autoSettings()): number {
  // 人の作業待ち（まだない仕組みが要るもの）は、週の上限に数えない（別に、同時に何件までと数える）
  // 人の作業待ちから作り始めたものは、作った日ではなく「済み」にした日から数える（長く待ったものも、作り始めた週に数える）
  const n = (db().prepare("SELECT COUNT(*) AS n FROM projects p WHERE p.deep = 1 AND p.demo = 0 AND COALESCE(p.needs_done_at, p.created_at) >= datetime('now', '-7 days') AND NOT (p.needs IS NOT NULL AND p.needs_done = 0 AND p.stage = 'idea')").get() as { n: number }).n;
  return Math.max(0, s.deepPerWeek - n);
}

// 人が確かめるときに見せる例。偏らないように、全体から等間隔に取る
export function sampleRows<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  const step = rows.length / n;
  return Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)]);
}

const KEY = /^[a-z][a-z0-9_]{0,30}$/;
// 表の位置の範囲で分けたグループ（「153〜202字目」など）を見分ける。こう分けた設計は、形が正しくないとしてAIにやり直させる（中身を挙げられず、空の一覧が返ってくるため）
// 全角の数字・記号は半角にそろえてから見る（「１５３〜２０２字目」も見分ける）
// - 数の範囲に、位置を表す言葉が付いている（「153〜202字目」「40番目〜80番目」）
// - 位置を表す語と、数の範囲が一緒にある（「掲載順 153〜202」「No.153-202」）
const POSITION_SUFFIX = "(?:字目|番目|件目|行目|位)";
const RANGE = "\\d+\\s*" + POSITION_SUFFIX + "?\\s*[〜~\\-–—ー]\\s*\\d+";
export const isPositionalGroup = (g: string) => {
  const t = g.normalize("NFKC");
  return new RegExp(`\\d+\\s*${POSITION_SUFFIX}\\s*[〜~\\-–—ー]|${RANGE}\\s*${POSITION_SUFFIX}`).test(t)
    || (/掲載順|配当順|並び順|通し番号|番号|順番|位置|No\.\s*\d|#\s*\d/i.test(t) && new RegExp(RANGE).test(t));
};

export function isDeepSpec(v: unknown): v is DeepSpec {
  return isObj(v) && Array.isArray(v.fields) && v.fields.length >= 1 && v.fields.length <= 12
    && v.fields.every((f) => isObj(f) && isStr(f.key) && KEY.test(f.key) && isStr(f.label) && (f.kind === "fact" || f.kind === "view"))
    && new Set(v.fields.map((f) => (f as DeepField).key)).size === v.fields.length
    && Array.isArray(v.groups) && v.groups.length >= 1 && v.groups.length <= DEEP_GROUP_MAX && v.groups.every(isStr) && !v.groups.some((g) => isPositionalGroup(g as string))
    && isStr(v.per_group) && isStr(v.note);
}

// 行から、決めた項目の形にそろったものだけを残す（値は文字・数・真偽だけ。長すぎる文字は切る）
// 空欄（"" や null）は「該当なし」として残す（例: 別の字体がない漢字）。最初の項目（その行が何かを表す名前など）が空の行と、項目が欠けた行は捨てる
// max: 1回で受け取る件数の上限（AIの1グループ分。人が入れるときは全体の上限）
export function cleanRows(raw: unknown, fields: DeepField[], max = DEEP_ROWS_PER_GROUP): DeepRow[] {
  if (!Array.isArray(raw)) return [];
  const out: DeepRow[] = [];
  for (const r of raw.slice(0, max)) {
    if (!isObj(r)) continue;
    const row: DeepRow = {};
    let ok = true;
    for (const f of fields) {
      const v = r[f.key];
      if (typeof v === "string") row[f.key] = v.trim().slice(0, 200);
      else if (v === null) row[f.key] = "";
      else if (typeof v === "number" && Number.isFinite(v)) row[f.key] = v;
      else if (typeof v === "boolean") row[f.key] = v;
      else { ok = false; break; }
    }
    if (ok && row[fields[0].key] !== "") out.push(row);
  }
  return out;
}

// CSV を行の配列にする（"…" で囲んだ値の中のカンマ・改行・"" に対応）
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// 人が入れたデータ（CSV か JSON）を、決めた項目の形にする。spec があれば、見出しを項目の key か label に合わせる
// spec がない（AIが設計の前に失敗した）ときは、CSV の見出し・JSON の最初の行の名前から項目を作る（すべて事実の項目として扱う）
export function parseUploadedData(text: string, spec: DeepSpec | null): { fields: DeepField[]; rows: DeepRow[] } {
  const t = text.trim();
  if (!t) throw new Error("データが空です");
  let objs: Record<string, unknown>[];
  let headers: string[];
  if (t.startsWith("[") || t.startsWith("{")) {
    let v: unknown;
    try { v = JSON.parse(t); } catch { throw new Error("JSON として読めませんでした"); }
    const arr = Array.isArray(v) ? v : isObj(v) && Array.isArray(v.rows) ? v.rows : null;
    if (!arr || !arr.length || !isObj(arr[0])) throw new Error("JSON は、1件ずつの配列（または {\"rows\": [...]}）にしてください");
    objs = arr.filter(isObj);
    headers = Object.keys(objs[0]);
  } else {
    const table = parseCsv(t);
    if (table.length < 2) throw new Error("CSV は、1行目に見出し、2行目からデータを書いてください");
    headers = table[0].map((h) => h.trim());
    // 同じ見出しが2つあると、どちらかの列が消えるので止める（空の見出しが2つ以上あるときも同じ）
    const dup = headers.find((h, i) => headers.indexOf(h) !== i);
    if (dup !== undefined) throw new Error(dup ? `見出し「${dup}」が重なっています。見出しはそれぞれ別の名前にしてください` : "空の見出しが2つ以上あります。見出しはそれぞれ名前を付けてください");
    objs = table.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  }
  let fields: DeepField[];
  let keyOf: (h: string) => string | null;
  if (spec) {
    fields = spec.fields;
    keyOf = (h) => spec.fields.find((f) => f.key === h || f.label === h)?.key ?? null;
  } else {
    // key は重ならないようにする（「日本語,col1」のように、作った key と見出しがぶつかるときは、後ろに番号を付ける）
    const taken = new Set<string>();
    fields = headers.slice(0, 12).map((h, i) => {
      let key = KEY.test(h) && !taken.has(h) ? h : `col${i + 1}`;
      for (let n = 2; taken.has(key); n++) key = `col${i + 1}_${n}`;
      taken.add(key);
      return { key, label: h || `列${i + 1}`, kind: "fact" as const };
    });
    keyOf = (h) => fields[headers.indexOf(h)]?.key ?? null;
  }
  const used = new Set(headers.map(keyOf).filter((k): k is string => !!k));
  if (!used.has(fields[0].key)) throw new Error(`見出しに「${fields[0].label}」（${fields[0].key}）がありません。見出しは項目の名前か key にしてください`);
  const mapped = objs.map((o) => {
    const r: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.key, ""]));
    for (const [h, v] of Object.entries(o)) {
      const k = keyOf(h);
      if (k) r[k] = typeof v === "number" || typeof v === "boolean" ? v : v == null ? "" : String(v);
    }
    return r;
  });
  const rows = capRows(cleanRows(mapped, fields, Number.MAX_SAFE_INTEGER));
  if (!rows.length) throw new Error("取り込める行がありませんでした");
  return { fields, rows };
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
- グループは、名前を見ただけで中身を自分で挙げられる分け方にする（例: 都道府県・読みの行（あ行・か行）・分野）。「公式の表の何番目から何番目」のような、表の並び順や位置の範囲では分けない（位置は確かめられず、中身を挙げられない）
- 公的な表など、正しい答えが1つに決まる事実だけの一覧は、AIの下書きに誤りが混ざりやすい。note に「人が公式の表のデータで入れ替えるとよい」と、元になる表の名前を書く
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
