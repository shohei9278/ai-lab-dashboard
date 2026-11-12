import { db, getSettings, monthSpendUsd, type ProjectRow } from "./db";
import { claudeModelId } from "./ai";
import { getProject } from "./loop";
import { judgePages, pageSystem, shootPage, staticPageIssues, writePageHtml, type PageCheck, type PageJudge } from "./freePage";
import { pickRefs } from "./designRefs";
import { imgOriginsOf } from "../../lp-site/src/lp/pageHtml";
import type { Lp } from "../../lp-site/src/lp/content";

// プロンプトの比較（AIの成績）
// 同じ案件・同じAI（Claude）で、指示の渡し方を1か所だけ変えたLPを2つ作り、3社が作り方を伏せて画面で採点する
// - a は今の渡し方、b は変えた渡し方。作ったLPは案件には使わない（比べるだけ）
// - 一度に1件だけ動かす。費用は実行の前に、これまでの実績から見積もる

export const FACTORS = {
  role: { label: "役割の一文", a: "あり（今のまま）", b: "なし", why: "「あなたは〜です」の一文で、質が変わるか" },
  rules: { label: "守ることの量", a: "今の指示", b: "短く整理した指示", why: "禁止が多いと、無難な見た目に寄るか" },
  refs: { label: "見本", a: "なし（今のまま）", b: "参考のLPの画面を3件見せる", why: "プロの見本を見せると、質が上がるか" },
  reader: { label: "対象者の目", a: "なし（今のまま）", b: "対象者として考えてから書く", why: "書き手ではなく読み手の目で考えさせると変わるか" },
  effort: { label: "考える量", a: "ふつう（今のまま）", b: "少なめ（medium）", why: "減らしても質が保てるなら、費用を下げられる" },
  review: { label: "見直し", a: "1回で書く（今のまま）", b: "書いたあと自分で見直して直す", why: "自分で見直させると、質が上がるか" },
} as const;
export type Factor = keyof typeof FACTORS;
export const isFactor = (v: unknown): v is Factor => typeof v === "string" && Object.hasOwn(FACTORS, v);

const LP_PURPOSE = "プロンプトの比較（LP）";
const JUDGE_PURPOSE = "プロンプトの比較（採点）";
const STALE_MINUTES = 40;
const REVIEW_NOTE = "このページの対象者になったつもりで、自分の作ったページを見直す。最初の3秒で何のページか分かるか、自分のことだと感じるか、登録したくなるかの観点で、いちばん効く直し所を3つ決めて直す";

export type Side = { shots: string[]; pc?: string; issues: string[]; chars: number };
export type PromptTestRow = {
  id: number; at: string; finished_at: string | null; project_id: number; factor: string; model_id: string; status: "running" | "done" | "error";
  a_json: string | null; b_json: string | null; score_a: number | null; score_b: number | null; judges: string | null; cost_usd: number | null; error: string | null;
};
export type PromptTest = Omit<PromptTestRow, "a_json" | "b_json" | "judges"> & { title: string; a: Side | null; b: Side | null; judges: PageJudge[] };

// 比べられる案件: 事前登録LP（ツールの案件は、ページの作りが違うので外す）で、文言の材料があるもの
export function testableProjects(): { id: number; title: string }[] {
  return db().prepare("SELECT id, title FROM projects WHERE demo = 0 AND kind = 'lp' AND lp IS NOT NULL ORDER BY id DESC LIMIT 50").all() as { id: number; title: string }[];
}

// 1回あたりの費用の見積もり（円）。これまでの実績の平均から出す。実績がなければ控えめに多めの値
export function estimateJpy(factor: Factor): number {
  const avg = (purposes: string[], fallback: number) => {
    const r = db().prepare(`SELECT AVG(cost_usd) AS c FROM (SELECT cost_usd FROM ai_calls WHERE error IS NULL AND purpose IN (${purposes.map(() => "?").join(",")}) ORDER BY id DESC LIMIT 30)`).get(...purposes) as { c: number | null };
    return r.c ?? fallback;
  };
  const page = avg(["LPのデザイン", LP_PURPOSE], 0.8);
  const judge = avg(["LPのデザインの採点", JUDGE_PURPOSE], 0.08);
  const pages = factor === "review" ? 3 : 2;
  return Math.round((page * pages + judge * 3) * getSettings().usdJpy);
}

// 途中で止まったまま（サーバーの再起動など）の比較は、失敗として閉じる
function closeStale() {
  db().prepare(`UPDATE prompt_tests SET status = 'error', error = '途中で止まりました（サーバーの再起動など）', finished_at = datetime('now') WHERE status = 'running' AND at < datetime('now', '-${STALE_MINUTES} minutes')`).run();
}

export function runningTest(): PromptTestRow | null {
  closeStale();
  return (db().prepare("SELECT * FROM prompt_tests WHERE status = 'running' ORDER BY id DESC LIMIT 1").get() as PromptTestRow | undefined) ?? null;
}

// 比較を始める（裏で進める。結果は AIの成績 > プロンプトの比較 に出る）
export function startPromptTest(projectId: number, factor: unknown): number {
  if (!isFactor(factor)) throw new Error("比べる項目が正しくありません");
  const s = getSettings();
  if (s.killSwitch) throw new Error("緊急停止中のため、比較できません");
  if (runningTest()) throw new Error("ほかの比較が動いています。終わってから実行してください");
  const p = getProject(projectId);
  if (!p || p.demo || p.kind !== "lp" || !p.lp) throw new Error("比べられるのは、文言の材料がある事前登録LPの案件だけです");
  const modelId = claudeModelId();
  if (!modelId) throw new Error("Claude のAPIキーがないため、比較できません");
  const cost = estimateJpy(factor);
  if (monthSpendUsd() * s.usdJpy + cost > s.monthlyBudgetJpy) throw new Error(`今月の予算の残りが、比較1回分（約${cost}円）に足りません`);
  if (factor === "refs" && !pickRefs(p.target, 3).length) throw new Error("参考のLPがまだ登録されていないため、見本の比較はできません");
  const id = Number(db().prepare("INSERT INTO prompt_tests (project_id, factor, model_id) VALUES (?, ?, ?)").run(p.id, factor, modelId).lastInsertRowid);
  void runPromptTest(id, p, factor, modelId).catch((e) => {
    db().prepare("UPDATE prompt_tests SET status = 'error', error = ?, finished_at = datetime('now'), cost_usd = ? WHERE id = ?")
      .run((e instanceof Error ? e.message : String(e)).slice(0, 300), spentOn(id), id);
  });
  return id;
}

// この比較で使った費用（この比較を始めてから、この案件で、比較の目的で呼んだAIの合計）
function spentOn(id: number): number {
  const t = db().prepare("SELECT at, project_id FROM prompt_tests WHERE id = ?").get(id) as { at: string; project_id: number };
  return (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_calls WHERE project_id = ? AND at >= ? AND purpose IN (?, ?)").get(t.project_id, t.at, LP_PURPOSE, JUDGE_PURPOSE) as { c: number }).c;
}

// 片方の渡し方で、LPを作って画面を撮る
async function makeSide(p: ProjectRow, lp: Lp, factor: Factor, changed: boolean, modelId: string, name: string): Promise<{ check: PageCheck; side: Side }> {
  const opts = {
    modelId,
    purpose: LP_PURPOSE,
    system: pageSystem({ role: !(changed && factor === "role"), shortRules: changed && factor === "rules", reader: changed && factor === "reader" }),
    effort: changed && factor === "effort" ? ("medium" as const) : undefined,
    refs: changed && factor === "refs" ? pickRefs(p.target, 3) : undefined,
  };
  let html = await writePageHtml(p, lp, opts);
  if (changed && factor === "review") html = await writePageHtml(p, lp, { ...opts, prevHtml: html, instruction: REVIEW_NOTE });
  const shots = await shootPage(html, imgOriginsOf(lp.design?.illustration?.url, html), name);
  if (shots.skipped) throw new Error(shots.skipped);
  const issues = [...staticPageIssues(html), ...shots.errors, ...(shots.overflow ? ["スマホ幅で横にはみ出している"] : [])];
  const check: PageCheck = { kind: "page", ok: issues.length === 0, issues, shots: shots.sp.map((s) => s.file), pc: shots.pc?.file, at: new Date().toISOString() };
  return { check, side: { shots: check.shots, pc: check.pc, issues, chars: html.length } };
}

async function runPromptTest(id: number, p: ProjectRow, factor: Factor, modelId: string) {
  const lp = JSON.parse(p.lp!) as Lp;
  const [a, b] = await Promise.all([
    makeSide(p, lp, factor, false, modelId, `cmp${id}-a`),
    makeSide(p, lp, factor, true, modelId, `cmp${id}-b`),
  ]);
  const f = FACTORS[factor];
  const j = await judgePages(p, a.check, b.check, { a: `今の渡し方（${f.a}）`, b: `変えた渡し方（${f.b}）` }, JUDGE_PURPOSE);
  db().prepare("UPDATE prompt_tests SET status = 'done', finished_at = datetime('now'), a_json = ?, b_json = ?, score_a = ?, score_b = ?, judges = ?, cost_usd = ? WHERE id = ?")
    .run(JSON.stringify(a.side), JSON.stringify(b.side), j.scoreA, j.scoreB, JSON.stringify(j.judges), spentOn(id), id);
}

const parse = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

export function listPromptTests(limit = 50): PromptTest[] {
  closeStale();
  const rows = db().prepare("SELECT t.*, p.title FROM prompt_tests t JOIN projects p ON p.id = t.project_id ORDER BY t.id DESC LIMIT ?").all(limit) as (PromptTestRow & { title: string })[];
  return rows.map((r) => ({ ...r, a: parse<Side>(r.a_json), b: parse<Side>(r.b_json), judges: parse<PageJudge[]>(r.judges) ?? [] }));
}

// 項目ごとのまとめ: 終わった回数、変えた渡し方が勝った回数、点の差の平均（変えた渡し方 − 今の渡し方）
export function factorSummary(): { factor: Factor; n: number; bWins: number; ties: number; diff: number | null }[] {
  const rows = db().prepare("SELECT factor, score_a, score_b FROM prompt_tests WHERE status = 'done' AND score_a IS NOT NULL AND score_b IS NOT NULL").all() as { factor: string; score_a: number; score_b: number }[];
  return (Object.keys(FACTORS) as Factor[]).map((factor) => {
    const list = rows.filter((r) => r.factor === factor);
    const diff = list.length ? Math.round((list.reduce((n, r) => n + (r.score_b - r.score_a), 0) / list.length) * 10) / 10 : null;
    return { factor, n: list.length, bWins: list.filter((r) => r.score_b > r.score_a).length, ties: list.filter((r) => r.score_b === r.score_a).length, diff };
  });
}
