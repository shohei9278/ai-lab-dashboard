import { db, type ProjectRow } from "./db";
import { channelRows, funnel, type Funnel } from "./funnel";
import { jstDateTime } from "./format";
import { getProject, logEvent } from "./loop";

// ページの改善の「答え合わせ」（11/26 に運営者が決めた）
// 改善を決めるとき（案件の判断・朝会）に、予想・変える所・見る数字・いつ判断するかを先に決めて、新しい版に残す。
// 新しい版の訪問が決めた人数に届くか、期限が来たら、直す前の版と、決めた数字だけで比べる（AIは呼ばない）。
// 結果が出てから都合のよい説明を作らないため。答え合わせを待っている間は、同じ案件のページを自動では直さない（2か所を同時に変えないため）

export type CheckMetric = "use" | "tool_view" | "play60" | "results2" | "share" | "revisit" | "half" | "cta" | "signup";
type Rate = { n: number; den: number } | null;

// 見る数字。ツールとLPで選べるものが違う。割合は、直す前と後で同じ数え方にする
export const CHECK_METRICS: Record<CheckMetric, { label: string; kind: "tool" | "lp"; rate: (f: Funnel) => Rate }> = {
  use: { label: "ツールを操作した割合（訪問に対して）", kind: "tool", rate: (f) => step(f, "use") },
  tool_view: { label: "ツールが画面に入った割合（訪問に対して）", kind: "tool", rate: (f) => step(f, "tool_view") },
  play60: { label: "1分以上遊んだ割合（遊び始めた人に対して）", kind: "tool", rate: (f) => (f.play?.hasData ? { n: f.play.time.find((x) => x.mark === 60)?.visitors ?? 0, den: f.play.users } : null) },
  results2: { label: "結果を2回以上出した割合（遊び始めた人に対して）", kind: "tool", rate: (f) => (f.play?.hasData ? { n: f.play.results.find((x) => x.mark === 2)?.visitors ?? 0, den: f.play.users } : null) },
  share: { label: "シェアした割合（訪問に対して）", kind: "tool", rate: (f) => step(f, "share") },
  revisit: { label: "別の日にまた来た人の割合（訪問に対して）", kind: "tool", rate: (f) => (f.play ? { n: f.play.revisit, den: f.visits } : null) },
  half: { label: "ページの半分まで読んだ割合（訪問に対して）", kind: "lp", rate: (f) => (f.hasEvents ? step(f, "half") : null) },
  cta: { label: "登録ボタンを押した割合（訪問に対して）", kind: "lp", rate: (f) => (f.hasEvents ? step(f, "cta") : null) },
  signup: { label: "事前登録した割合（訪問に対して）", kind: "lp", rate: (f) => step(f, "signup") },
};

function step(f: Funnel, key: string): Rate {
  const s = f.steps.find((x) => x.key === key);
  return s ? { n: s.visitors, den: f.visits } : null;
}

// 決めた人数・期限の範囲と、決めなかったときの値
export const CHECK_MIN_VISITS = { min: 10, max: 100, default: 30 };
export const CHECK_DAYS = { min: 3, max: 14, default: 7 };
// 直す前の版の訪問がこれより少ないときは、比べられないとする
export const CHECK_BEFORE_MIN = 10;
// 割合の差がこれより小さいときは「差がはっきりしない」とする（人数が少ないので、小さな差は偶然の可能性が高い）
export const CHECK_DIFF = 0.05;

export type ImproveCheck = { why: string; part: string; metric: CheckMetric; minVisits: number; days: number; defaulted: string[]; before: number; at: string };
export type CheckVerdict = "better" | "worse" | "flat" | "unclear";
export const VERDICT_LABEL: Record<CheckVerdict, string> = { better: "良くなった", worse: "悪くなった", flat: "差がはっきりしない", unclear: "判断できなかった" };

// ねらいに合わせた、見る数字の決まった値（AIが決めなかった・選べない数字を選んだとき）
export function defaultMetric(p: Pick<ProjectRow, "kind" | "aim">): CheckMetric {
  if (p.kind !== "tool") return "signup";
  if (p.aim === "spread") return "play60";
  if (p.aim === "return") return "revisit";
  return "use";
}

export function metricsFor(kind: string): CheckMetric[] {
  return (Object.keys(CHECK_METRICS) as CheckMetric[]).filter((k) => CHECK_METRICS[k].kind === (kind === "tool" ? "tool" : "lp"));
}

// AIへの指示（判断・朝会で、改善を選ぶときに書かせる）
export function checkRule(kind: string): string {
  return `改善を選ぶときは、check も書く: why（なぜ今の数字になっていると予想するか。1文）・metric（直したあとに見る数字。${metricsFor(kind).map((k) => `${k}=${CHECK_METRICS[k].label}`).join(" / ")}）・min_visits（判断に要る新しい版の訪問。${CHECK_MIN_VISITS.min}〜${CHECK_MIN_VISITS.max}）・days（判断する期限の日数。${CHECK_DAYS.min}〜${CHECK_DAYS.max}）。結果が出てから見る数字を変えないよう、先に決める。答え合わせが終わるまで、同じ案件のページは自動では直さない`;
}

// 人数・日数は、数か数の文字だけを受け付け、丸める前に「整数で範囲の中」かを確かめる（変な形の値・小数・範囲の外は使わず、決まった値にする。PR #208 の ai-review の指摘）
const clampInt = (v: unknown, r: { min: number; max: number }): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= r.min && n <= r.max ? n : null;
};

// AIが書いた check を整える。書かなかった・範囲の外の項目は、決まった値を入れて defaulted に残す
export function parseCheck(raw: unknown, p: Pick<ProjectRow, "kind" | "aim">, instruction: string, before: number, at = new Date().toISOString()): ImproveCheck {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const defaulted: string[] = [];
  const str = (k: string, fallback: string) => {
    const v = typeof o[k] === "string" ? (o[k] as string).trim() : "";
    if (v) return v.slice(0, 200);
    defaulted.push(k);
    return fallback;
  };
  const why = str("why", "（予想は書かれなかった）");
  // 変えた所は、実際に直す指示そのもの（別に書かせると、直した所と記録が食い違うことがあるため。PR #208 の ai-review の指摘）
  const part = instruction.trim().slice(0, 200) || "（書かれなかった）";
  const metric = typeof o.metric === "string" && metricsFor(p.kind).includes(o.metric as CheckMetric) ? (o.metric as CheckMetric) : (defaulted.push("metric"), defaultMetric(p));
  const minVisits = clampInt(o.min_visits, CHECK_MIN_VISITS) ?? (defaulted.push("min_visits"), CHECK_MIN_VISITS.default);
  const days = clampInt(o.days, CHECK_DAYS) ?? (defaulted.push("days"), CHECK_DAYS.default);
  return { why, part, metric, minVisits, days, defaulted, before, at };
}

// 朝会の予定に残す形（要る項目だけを取り出し、項目ごとに長さを切ってから JSON にする。JSON にしてから切ると壊れるため。PR #208 の ai-review の指摘）
export function checkJson(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pick: Record<string, unknown> = {};
  if (typeof o.why === "string") pick.why = o.why.slice(0, 200);
  if (typeof o.metric === "string") pick.metric = o.metric.slice(0, 20);
  for (const k of ["min_visits", "days"] as const) if (typeof o[k] === "number" || typeof o[k] === "string") pick[k] = Number(o[k]);
  return Object.keys(pick).length ? JSON.stringify(pick) : null;
}

// 新しい版に、答え合わせの予定を残す
export function saveCheck(projectId: number, version: number, check: ImproveCheck): void {
  db().prepare("UPDATE lp_versions SET improve_check = ?, check_verdict = NULL, check_result = NULL, check_decided_at = NULL WHERE project_id = ? AND version = ?")
    .run(JSON.stringify(check), projectId, version);
  logEvent(projectId, "ai", "improve-check", `第${version}版の答え合わせを決めました: 予想「${check.why}」・変える所「${check.part}」・見る数字「${CHECK_METRICS[check.metric].label}」・訪問${check.minVisits}人か${check.days}日で判断${check.defaulted.length ? `（${check.defaulted.join("・")} はAIが決めなかったため、決まった値）` : ""}`);
}

type CheckRow = { project_id: number; version: number; improve_check: string; check_verdict: string | null; check_result: string | null; check_decided_at: string | null; created_at: string };
const parse = (r: CheckRow): ImproveCheck | null => {
  try {
    return JSON.parse(r.improve_check) as ImproveCheck;
  } catch {
    return null;
  }
};
const deadline = (c: ImproveCheck) => Date.parse(c.at) + c.days * 86_400_000;
const pct = (r: Rate) => (r && r.den ? `${Math.round((r.n / r.den) * 100)}%（${r.n}/${r.den}人）` : "—");

// 答え合わせを待っている版（同じ案件のページを自動で直さないため。improveBlocked から呼ぶ）
export function pendingCheck(projectId: number, now = Date.now()): { version: number; check: ImproveCheck; until: string } | null {
  const r = db().prepare("SELECT * FROM lp_versions WHERE project_id = ? AND improve_check IS NOT NULL AND check_verdict IS NULL ORDER BY version DESC LIMIT 1").get(projectId) as CheckRow | undefined;
  const c = r ? parse(r) : null;
  if (!r || !c || now >= deadline(c)) return null;
  return { version: r.version, check: c, until: new Date(deadline(c)).toISOString() };
}

// 同じ期間の届け方（流入元の内訳と、投稿・試し）。結果と並べて残す（届け方が変わった分を、直しの効果と読み違えないように）
// 投稿と試しは、答え合わせを始めた時刻から until（期限・次の版に替わった時刻・今）までで区切る（あとの分が混ざらないように。PR #208 の ai-review の指摘）
function reachText(p: ProjectRow, before: number, after: number, from: string, until: string): string {
  const top = (v: number) => channelRows(p.id, v, true).sort((a, b) => b.visitors - a.visitors).slice(0, 3).map((c) => `${c.label} ${c.visitors}人`).join("・") || "記録なし";
  const sql = (t: string) => (t.includes("T") ? new Date(t).toISOString() : `${t.replace(" ", "T")}Z`).slice(0, 19).replace("T", " ");
  const [f, u] = [sql(from), sql(until)];
  const posts = db().prepare("SELECT platform, COUNT(*) AS n FROM sns_posts WHERE project_id = ? AND status = 'posted' AND posted_at >= ? AND posted_at < ? GROUP BY platform").all(p.id, f, u) as { platform: string; n: number }[];
  const trials = (db().prepare("SELECT question FROM plan_trials WHERE project_id = ? AND created_at >= ? AND created_at < ?").all(p.id, f, u) as { question: string }[]).map((t) => t.question.slice(0, 40));
  return `流入元 直す前（第${before}版）: ${top(before)} / 直したあと（第${after}版）: ${top(after)}・直したあとの投稿: ${posts.map((x) => `${x.platform} ${x.n}件`).join("・") || "なし"}${trials.length ? `・この間の試し: ${trials.join(" / ")}` : ""}`;
}

// 1つの版の答え合わせ（決めた人数に届くか、期限が来たら）。まだ判断しないときは null
export function judgeCheck(p: ProjectRow, version: number, c: ImproveCheck, now = Date.now()): { verdict: CheckVerdict; result: string } | null {
  const after = funnel(p, version);
  const expired = now >= deadline(c);
  if (after.visits < c.minVisits && !expired) return null;
  const m = CHECK_METRICS[c.metric];
  const before = funnel(p, c.before);
  const b = m.rate(before);
  const a = m.rate(after);
  const head = `見た数字: ${m.label}。直す前（第${c.before}版） ${pct(b)} → 直したあと（第${version}版） ${pct(a)}`;
  const reach = reachText(p, c.before, version, c.at, new Date(Math.min(now, deadline(c))).toISOString());
  const unclear = (why: string) => ({ verdict: "unclear" as const, result: `${head}。判断できなかった理由: ${why}\n${reach}` });
  // 期限を過ぎてから見るときは、判断しない。決めた人数に届けば、期限の前でも見回り（5分ごと）ですぐ答え合わせするので、
  // 期限を過ぎて初めて見るのは、届かなかったか、期限のうちに届いたかを確かめられないとき（訪問の記録には日にちしかなく、期限の時刻で区切れない。PR #208 の ai-review の指摘）
  if (expired) {
    return unclear(after.visits < c.minVisits
      ? `期限（${c.days}日）までに、新しい版の訪問が決めた${c.minVisits}人に届かなかった（${after.visits}人）`
      : `期限（${jstDateTime(new Date(deadline(c)).toISOString())}）のうちに、決めた${c.minVisits}人に届いたかを確かめられない（期限のあとに届いた分が混ざる）`);
  }
  if (before.visits < CHECK_BEFORE_MIN) return unclear(`直す前の版の訪問が少ない（${before.visits}人）`);
  if (!a || !b || !a.den || !b.den) return unclear("この数字の記録が、直す前か直したあとの版に届いていない");
  const diff = a.n / a.den - b.n / b.den;
  // 割合を小数で引くと、ちょうど5ポイントの差が誤差で「差がはっきりしない」になるので、整数のかけ算で比べる（PR #208 の ai-review の指摘）
  const cross = a.n * b.den - b.n * a.den; // 符号は差の向き
  const verdict: CheckVerdict = Math.abs(cross) * 100 < Math.round(CHECK_DIFF * 100) * a.den * b.den ? "flat" : cross > 0 ? "better" : "worse";
  return { verdict, result: `${head}（${diff >= 0 ? "+" : ""}${Math.round(diff * 100)}ポイント）\n${reach}` };
}

// 見回りから呼ぶ（AIは呼ばない）。判断できたものを残して、数を返す
export function evaluateImproveChecks(now = Date.now()): number {
  const rows = db().prepare("SELECT * FROM lp_versions WHERE improve_check IS NOT NULL AND check_verdict IS NULL").all() as CheckRow[];
  let n = 0;
  for (const r of rows) {
    const p = getProject(r.project_id);
    const c = parse(r);
    if (!p || !c) continue;
    // 答え合わせの前に次の版に替わったら、比べられない（2か所を変えたことになる）
    const newer = db().prepare("SELECT created_at FROM lp_versions WHERE project_id = ? AND version > ? ORDER BY version LIMIT 1").get(r.project_id, r.version) as { created_at: string } | undefined;
    const out = newer && (p.public_version ?? p.lp_version) !== r.version
      ? { verdict: "unclear" as const, result: `判断できなかった理由: 答え合わせの前に、次の版に替わった\n${reachText(p, c.before, r.version, c.at, newer.created_at)}` }
      : judgeCheck(p, r.version, c, now);
    if (!out) continue;
    db().prepare("UPDATE lp_versions SET check_verdict = ?, check_result = ?, check_decided_at = datetime('now') WHERE project_id = ? AND version = ?").run(out.verdict, out.result.slice(0, 1000), r.project_id, r.version);
    logEvent(r.project_id, "system", "improve-check-result", `第${r.version}版の答え合わせ: ${VERDICT_LABEL[out.verdict]}（予想「${c.why}」・変えた所「${c.part}」）\n${out.result}`);
    n++;
  }
  return n;
}

// AIの材料（案件の判断・朝会・定例会議）: 予想 → 変えた所 → 見た数字 → 結果 の順に並べる
export function improveChecksText(projectId: number | null = null, limit = 5): string {
  const rows = db().prepare(`SELECT * FROM lp_versions WHERE improve_check IS NOT NULL ${projectId ? "AND project_id = ?" : ""} ORDER BY COALESCE(check_decided_at, created_at) DESC LIMIT ?`)
    .all(...(projectId ? [projectId, limit] : [limit])) as CheckRow[];
  const lines = rows.flatMap((r) => {
    const c = parse(r);
    if (!c) return [];
    const who = projectId ? "" : `#${r.project_id} `;
    const state = r.check_verdict
      ? `結果: ${VERDICT_LABEL[r.check_verdict as CheckVerdict]}。${(r.check_result ?? "").replace(/\n/g, "。")}`
      : `答え合わせ待ち（新しい版の訪問${c.minVisits}人か、${jstDateTime(new Date(deadline(c)).toISOString())}まで。それまで、この案件のページは自動では直さない）`;
    return [`- ${who}第${r.version}版: 予想「${c.why}」→ 変えた所「${c.part}」→ 見る数字「${CHECK_METRICS[c.metric].label}」→ ${state}`];
  });
  if (!lines.length) return "";
  return `ページの直しの答え合わせ（直す前に決めた数字で、直す前の版と比べたもの。人数が少ないうちは偶然の差も大きい。同じ期間に届け方が変わっていれば、その分も数字に入っている）:\n${lines.join("\n")}`;
}

// 案件の画面（版の履歴）に出す1行。答え合わせのない版は null
export function checkSummary(v: { improve_check: string | null; check_verdict: string | null; check_result: string | null }): { verdict: CheckVerdict | null; plan: string; result: string } | null {
  if (!v.improve_check) return null;
  let c: ImproveCheck;
  try {
    c = JSON.parse(v.improve_check) as ImproveCheck;
  } catch {
    return null;
  }
  const verdict = (v.check_verdict as CheckVerdict | null) ?? null;
  return {
    verdict,
    plan: `予想「${c.why}」→ 変える所「${c.part}」→ 見る数字「${CHECK_METRICS[c.metric]?.label ?? c.metric}」`,
    // 判定と一緒に、同じ期間の届け方（2行目）も出す（判定を読むときに要るため。PR #208 の ai-review の指摘）
    result: verdict ? (v.check_result ?? "") : `答え合わせ待ち（新しい版の訪問${c.minVisits}人か、${jstDateTime(new Date(deadline(c)).toISOString())}まで）`,
  };
}
