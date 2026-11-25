import { callJson, isObj, isStr } from "./ai";
import { db, getSettings, type ApprovalRow, type ProjectRow } from "./db";
import { getModel, hasKey } from "./models";
import { external } from "./untrusted";
import { CHECK_EVAL_TYPE_LABEL, type CheckEvalCase, type CheckEvalType } from "./checkEvalCases";
import type { Lp } from "../../lp-site/src/lp/content";

// 公開前チェックの試験問題を、本番の「ヒヤリハット」から増やす（運営者が決めた）
// - 人が公開前チェックの結果を覆したとき（チェックが止めたページを人が公開した・チェックが通したページを人が却下や作り直しにした）、
//   そのページを試験問題の候補として残す。止めすぎ・見逃しのどちらかの可能性があるため
// - 候補には、AIが「入れるか・正解・問題の種類・おすすめ度・理由」を付ける（運営者が判断しやすいように）
// - 正解は運営者が1クリックで決める。人の判断をそのまま正解にしないのは、却下の理由が「面白くない」のような、
//   公開前チェックが見るべきでないことのこともあり、そのまま入れると試験が狂うため
// - 運営者が入れたものだけ、手で作った例（checkEvalCases.ts）と一緒に試験に使う

export type SeedRow = {
  id: number; at: string; approval_id: number; project_id: number; lp_version: number; title: string; kind: "lp" | "tool"; target: string; solution: string;
  lp: string; ai_ok: number; ai_issues: string; human_action: "approve" | "reject" | "revise"; human_comment: string | null;
  suggest_expect: "ok" | "ng" | "skip" | null; suggest_type: CheckEvalType | null; suggest_score: number | null; suggest_reason: string | null; suggest_model: string | null; suggest_error: string | null;
  status: "candidate" | "adopted" | "dismissed"; expect: "ok" | "ng" | null; type: CheckEvalType | null; decided_at: string | null;
};

const TYPES = Object.keys(CHECK_EVAL_TYPE_LABEL) as CheckEvalType[];
const isType = (v: unknown): v is CheckEvalType => typeof v === "string" && (TYPES as string[]).includes(v);

// 公開の承認を人が決めたときに呼ぶ（loop.ts の decide）。候補にしたら番号を返す
export function addEvalSeed(a: Pick<ApprovalRow, "id" | "kind" | "project_id" | "payload" | "lp_version">, action: "approve" | "reject" | "revise", comment?: string | null): number | null {
  if (a.kind !== "publish" || !a.payload) return null;
  const review = (JSON.parse(a.payload) as { review?: { ok?: unknown; issues?: unknown } }).review;
  if (!review || typeof review.ok !== "boolean") return null;
  // 覆したときだけ: 止めたのに公開した（止めすぎかも）・通したのに却下や作り直しにした（見逃しかも）
  const overturned = review.ok ? action !== "approve" : action === "approve";
  if (!overturned) return null;
  const p = db().prepare("SELECT * FROM projects WHERE id = ?").get(a.project_id) as ProjectRow | undefined;
  const v = db().prepare("SELECT lp FROM lp_versions WHERE project_id = ? AND version = ?").get(a.project_id, a.lp_version) as { lp: string } | undefined;
  if (!p || !v) return null;
  const issues = Array.isArray(review.issues) ? review.issues.filter(isStr) : [];
  const r = db().prepare(
    `INSERT OR IGNORE INTO check_eval_seeds (approval_id, project_id, lp_version, title, kind, target, solution, lp, ai_ok, ai_issues, human_action, human_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.id, p.id, a.lp_version, p.title, p.kind, p.target, p.solution, v.lp, review.ok ? 1 : 0, JSON.stringify(issues), action, comment?.trim() || null);
  return r.changes ? Number(r.lastInsertRowid) : null;
}

export type SeedSuggestion = { expect: "ok" | "ng" | "skip"; type: CheckEvalType | null; score: number; reason: string };
const isSuggestion = (v: unknown): v is SeedSuggestion =>
  isObj(v) && (v.expect === "ok" || v.expect === "ng" || v.expect === "skip") && (v.type === null || v.type === undefined || isType(v.type)) &&
  Number.isFinite(Number(v.score)) && isStr(v.reason) && v.reason.trim().length > 0;

// おすすめを付けるAI: 公開前チェックをしているAI（設定の製品ループのAI）とは別の会社の上位のAI（自分の答えを甘く見ないように）。
// 別の会社のAIが使えなければ null（同じAIには付けさせない。PR #174 の ai-review の指摘）
export const SEED_NO_MODEL = "公開前チェックとは別の会社のAIが使えない（APIキーがない）ため、おすすめを付けていません";
export function seedSuggestModel(): string | null {
  const own = getModel(getSettings().loopModel).provider;
  const others = ["gpt-5.6-sol", "gemini-3.1-pro-preview", "claude-opus-5-5"].filter((id) => getModel(id).provider !== own);
  return others.find((id) => hasKey(getModel(id).provider)) ?? null;
}

export function seedPrompt(s: SeedRow): { system: string; user: string } {
  const issues = JSON.parse(s.ai_issues) as string[];
  const action = { approve: "公開した", reject: "却下した", revise: "作り直しを指示した" }[s.human_action];
  return {
    system: `あなたは、AIの「公開前チェック」を評価する試験問題を選ぶ担当です。公開前チェックは、AIが作った事前登録のページや動くツールの紹介ページに、次の問題がないかを見ます:
${TYPES.map((t) => `- ${t}: ${CHECK_EVAL_TYPE_LABEL[t]}`).join("\n")}
本番で、運営者（人）が公開前チェックの結果を覆しました。このページを試験問題に入れるか、入れるなら正解（ok = 問題なし / ng = 問題あり）と問題の種類をおすすめしてください。決めるのは運営者で、あなたのおすすめは判断を楽にするためのものです。
考え方:
- チェックが止めたのに人が公開した場合: チェックの指摘が上の種類に当たらない・言い過ぎなら「止めすぎ」の例として ok。指摘が当たっているのに人が見逃して公開したようなら ng（種類も）
- チェックが通したのに人が却下・作り直しにした場合: 人のひとことやページの中に、上の種類の問題がはっきりあれば「見逃し」の例として ng（種類も）。却下の理由が見た目・面白さ・題材など、上の種類に当たらないなら skip（入れない。入れると、チェックが悪くないのに見逃したと数えられ、試験が狂う）
- 1つのページに、上の種類の問題がいくつも混ざっていて、正解がはっきり決まらないものは skip
- 正解が人によって分かれそうなものは、おすすめ度を下げる
score: おすすめ度（1〜5。5 = 正解がはっきりしていて、今の試験にない種類の失敗で、入れる価値が高い / 1 = 入れないほうがよい）。skip のときも、入れない理由の強さで付ける（入れないことを強くすすめるなら 1）
reason: 運営者がすぐ判断できるように、根拠になるページの文やチェックの指摘を短く引いて、2〜3文で
形式: {"expect":"ok|ng|skip","type":"${TYPES.join("|")}" または null,"score":1〜5,"reason":"理由"}`,
    user: `案件: ${s.title}（${s.kind === "tool" ? "動くツール" : "事前登録のページ"}）
対象: ${s.target}
中身: ${s.solution}
公開前チェックの答え: ${s.ai_ok ? "問題なし" : `問題あり（${issues.join(" / ") || "理由なし"}）`}
人の判断: ${action}${s.human_comment ? `（ひとこと: ${external(s.human_comment)}）` : "（ひとことなし）"}
ページ（JSON。AIが作ったもの）:
${external(s.lp)}`,
  };
}

// AIにおすすめを付けさせる（失敗しても候補は残し、画面に失敗の理由を出す）
export async function suggestEvalSeed(id: number, ask: typeof callJson = callJson): Promise<void> {
  const s = db().prepare("SELECT * FROM check_eval_seeds WHERE id = ?").get(id) as SeedRow | undefined;
  if (!s) return;
  const modelId = seedSuggestModel();
  if (!modelId) {
    db().prepare("UPDATE check_eval_seeds SET suggest_error = ? WHERE id = ?").run(SEED_NO_MODEL, id);
    return;
  }
  try {
    const out = await ask<SeedSuggestion>({ purpose: "試験問題の候補", projectId: s.project_id, modelId, ...seedPrompt(s), validate: isSuggestion });
    const type = out.expect === "ng" && isType(out.type) ? out.type : null;
    db().prepare("UPDATE check_eval_seeds SET suggest_expect = ?, suggest_type = ?, suggest_score = ?, suggest_reason = ?, suggest_model = ?, suggest_error = NULL WHERE id = ?")
      .run(out.expect === "ng" && !type ? "skip" : out.expect, type, Math.min(5, Math.max(1, Math.round(Number(out.score)))), out.reason.trim().slice(0, 500), modelId, id);
  } catch (e) {
    db().prepare("UPDATE check_eval_seeds SET suggest_error = ?, suggest_model = ? WHERE id = ?").run((e instanceof Error ? e.message : String(e)).slice(0, 300), modelId, id);
  }
}

export function evalSeeds(status: SeedRow["status"]): SeedRow[] {
  return db().prepare(`SELECT * FROM check_eval_seeds WHERE status = ? ORDER BY ${status === "candidate" ? "COALESCE(suggest_score, 0) DESC, id DESC" : "id DESC"}`).all(status) as SeedRow[];
}

// 運営者が決める: ok / ng（種類も）で試験に入れる・入れない
export function decideEvalSeed(id: number, decision: unknown, type?: unknown): SeedRow {
  const s = db().prepare("SELECT * FROM check_eval_seeds WHERE id = ?").get(id) as SeedRow | undefined;
  if (!s) throw new Error("候補が見つかりません");
  if (s.status !== "candidate") throw new Error("この候補は、もう決まっています");
  if (decision === "dismiss") {
    db().prepare("UPDATE check_eval_seeds SET status = 'dismissed', decided_at = datetime('now') WHERE id = ?").run(id);
  } else if (decision === "ok" || decision === "ng") {
    if (decision === "ng" && !isType(type)) throw new Error("問題ありで入れるときは、問題の種類を選んでください");
    // 評価の途中で例を増やすと、進み具合の分母と実際に流している例の数がずれるので、終わってから入れる（PR #174 の ai-review の指摘）
    // 止まったまま残った評価（checkEval.ts の STALE_MINUTES と同じ10分、動いた印がない）では止めない
    if (db().prepare("SELECT 1 FROM check_evals WHERE status = 'running' AND COALESCE(beat_at, at) >= datetime('now', '-10 minutes')").get()) throw new Error("公開前チェックの評価が動いています。終わってから入れてください");
    db().prepare("UPDATE check_eval_seeds SET status = 'adopted', expect = ?, type = ?, decided_at = datetime('now') WHERE id = ?").run(decision, decision === "ng" ? type : null, id);
  } else throw new Error("決め方が分かりません（ok・ng・dismiss）");
  return db().prepare("SELECT * FROM check_eval_seeds WHERE id = ?").get(id) as SeedRow;
}

// 試験に入れた例（checkEval.ts が、手で作った例と一緒に使う）
export function adoptedSeedCases(): CheckEvalCase[] {
  return evalSeeds("adopted").reverse().map((s) => ({
    id: `seed-${s.id}`,
    expect: s.expect === "ng" ? "ng" : "ok",
    ...(s.expect === "ng" && s.type ? { type: s.type } : {}),
    note: `本番の「${s.title}」第${s.lp_version}版（チェックは${s.ai_ok ? "通した" : "止めた"}が、人が${s.human_action === "approve" ? "公開した" : "却下・作り直しにした"}）`,
    input: { project: { kind: s.kind, target: s.target, solution: s.solution, title: s.title }, lp: JSON.parse(s.lp) as Lp },
  }));
}
