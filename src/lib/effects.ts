import { db } from "./db";
import { sourceLabel, type RequestRow } from "./plan";

// やった改善の答え合わせ: 提案箱で「やった」になった提案の、前後7日の1日あたりの数字
// 提案の「やった・見送り」は会議に渡していたが、やったあとに数字が良くなったかは誰も見ていなかった（運営者が、会議が過去に基づいて改善しているかを尋ね、足すと決めた）
// 案件の提案はその案件の数字、それ以外は全案件の合計で見る。同じ時期にほかの変更もあるので、1つの改善の効果とは言い切れない

const DAY = 86_400_000;
const jday = (t: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(t));
const dayStart = (d: string) => Date.parse(`${d}T00:00:00+09:00`);

// from 以上 to 未満の日の、訪問と成果の合計（デモ・仮の数字は除く）
function totals(from: string, to: string, projectId: number | null): { visits: number; conversions: number } {
  const r = db().prepare(
    `SELECT COALESCE(SUM(m.visits), 0) AS v, COALESCE(SUM(m.signups), 0) AS c FROM metrics m JOIN projects p ON p.id = m.project_id
     WHERE p.demo = 0 AND m.source != 'simulated' AND m.day >= ? AND m.day < ? ${projectId ? "AND m.project_id = ?" : ""}`,
  ).get(from, to, ...(projectId ? [projectId] : [])) as { v: number; c: number };
  return { visits: r.v, conversions: r.c };
}

type Sum = { visits: number; conversions: number };
// beforeDays: 前の日数。案件の提案は、案件を公開した日より前を数えない（公開前の0人を「前」に入れると、効いたように見える。提案箱 #117）
// whole: 作業の途中で出た仕組みの提案（ツールのチェックなど、作り方の改善）は、その案件だけでなく全案件の合計でも見る
export type DoneEffect = { id: number; title: string; target: string; source: string; day: string; projectId: number | null; afterDays: number; beforeDays: number; before: Sum; after: Sum; whole?: { before: Sum; after: Sum } };

// やってから days 日以内のもの（敗者復活は、やった＝案件を作ったことなので除く）
// now: 基準の時刻（対象を選ぶのも、期間を数えるのも、この時刻から。PR #127 の ai-review の指摘）
export function doneEffects(days = 28, now = Date.now()): DoneEffect[] {
  const utc = (t: number) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
  const rows = db().prepare("SELECT * FROM plan_requests WHERE status = 'done' AND source != 'revival' AND decided_at >= ? AND decided_at <= ? ORDER BY decided_at DESC LIMIT 15").all(utc(now - days * DAY), utc(now)) as RequestRow[];
  const today = jday(now);
  return rows.map((r) => {
    const day = jday(Date.parse(`${r.decided_at!.replace(" ", "T")}Z`));
    const end = jday(Math.min(dayStart(day) + 7 * DAY, dayStart(today))); // 今日はまだ途中なので数えない
    const afterDays = Math.max(0, Math.round((dayStart(end) - dayStart(day)) / DAY));
    const week = jday(dayStart(day) - 7 * DAY);
    let from = week;
    if (r.project_id) {
      const p = db().prepare("SELECT published_at FROM projects WHERE id = ?").get(r.project_id) as { published_at: string | null } | undefined;
      // まだ公開していない・やった日より後に公開した案件は、前の日がない
      const pub = p?.published_at ? jday(Date.parse(`${p.published_at.replace(" ", "T")}Z`)) : day;
      from = pub > week ? (pub < day ? pub : day) : week;
    }
    const beforeDays = Math.round((dayStart(day) - dayStart(from)) / DAY);
    const whole = r.project_id && r.source === "scene" && r.target === "system" ? { before: totals(week, day, null), after: totals(day, end, null) } : undefined;
    return {
      id: r.id, title: r.title, target: r.target, source: sourceLabel(r), day, projectId: r.project_id, afterDays, beforeDays,
      before: totals(from, day, r.project_id), after: totals(day, end, r.project_id), ...(whole ? { whole } : {}),
    };
  });
}

const perDay = (n: number, d: number) => (d ? (n / d).toFixed(1) : "—");
const nums = (b: Sum, bd: number, a: Sum, ad: number) => `訪問 ${perDay(b.visits, bd)} → ${perDay(a.visits, ad)}・成果 ${perDay(b.conversions, bd)} → ${perDay(a.conversions, ad)}`;

function line(x: DoneEffect): string {
  const head = `「${x.title}」（${x.target === "system" ? "仕組み" : "運営者"}・${x.source}・${x.day.slice(5)}にやった${x.projectId ? `・#${x.projectId}` : "・全案件"}）`;
  const late = x.afterDays < 3 ? "。まだ判断しない" : "";
  // 前が3日に満たないものは、注意だけにする（全案件の合計も並べない。数字があると、それで判断されてしまう。PR #239 のレビューの指摘）
  if (x.beforeDays < 3) return `- ${head}: ${x.projectId ? `#${x.projectId}は` : ""}前の数字がない（公開前）。まだ判断しない`;
  const own = `${x.whole ? `#${x.projectId}で ` : ""}${nums(x.before, x.beforeDays, x.after, x.afterDays)}（${x.beforeDays < 7 ? `前は${x.beforeDays}日分・` : ""}後は${x.afterDays}日分${late}）`;
  const whole = x.whole ? ` / 全案件の合計で ${nums(x.whole.before, 7, x.whole.after, x.afterDays)}（後は${x.afterDays}日分${late}）` : "";
  return `- ${head}: ${own}${whole}`;
}

export function doneEffectsText(days = 28): string {
  const xs = doneEffects(days);
  if (!xs.length) return "やった改善の前後: まだない";
  return `やった改善の前後（提案箱で「やった」になった日の前7日と後の、1日あたりの訪問・成果。案件の提案はその案件（公開した日より前は前に入れない）、ほかは全案件の合計。作業の途中で出た仕組みの提案は、全案件の合計でも並べる。前が3日に満たないものは、前の数字がないので判断しない。同じ時期にほかの変更や宣伝の量の違いもあるので、1つの改善の効果とは言い切れない。後が3日に満たないものは、まだ判断しない）:
${xs.map(line).join("\n")}`;
}
