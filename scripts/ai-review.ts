// CIから呼ぶ: コードを書いたClaudeとは別の会社のAI（GPT。REVIEWER=gemini なら Gemini）に差分を読ませ、結果をコミットかPRにコメントする
// 参考意見なのでデプロイは止めない。差分はレビューの対象としてだけ扱う
// ルーティンが作った PR（自動マージの対象）は、ここではなく自動マージの見回り（auto-merge.ts）が、main のコードの中で自分でレビューする
import { execFileSync } from "node:child_process";
import { reviewHistory, type PrComment } from "./ai-review-history";
import { OMITTED, omittedNote } from "./ai-review-omitted";
import { askReviewer, parseReview, reviewComment, reviewInput, reviewInstructions } from "./ai-review-core";

const { OPENAI_API_KEY, GEMINI_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY, BASE_SHA, HEAD_SHA, PR_NUMBER, PR_BODY } = process.env;
const REVIEWER = process.env.REVIEWER === "gemini" ? "gemini" : "gpt";

async function comment(body: string) {
  const url = PR_NUMBER
    ? `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments`
    : `https://api.github.com/repos/${GITHUB_REPOSITORY}/commits/${HEAD_SHA}/comments`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`コメントを投稿できませんでした（${res.status}）`);
}

// 同じPRの過去のコメントを読む（読めなくてもレビューは続ける）
async function pastComments(): Promise<PrComment[]> {
  if (!PR_NUMBER) return [];
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments?per_page=100`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    });
    const body: unknown = res.ok ? await res.json() : [];
    return Array.isArray(body) ? (body as PrComment[]) : [];
  } catch {
    return [];
  }
}

async function main() {
  if (REVIEWER === "gpt" && !OPENAI_API_KEY) return console.log("OPENAI_API_KEY がないため、AIのレビューを飛ばしました");
  if (REVIEWER === "gemini" && !GEMINI_API_KEY) return console.log("GEMINI_API_KEY がないため、Gemini のレビューを飛ばしました");
  const empty = !BASE_SHA || /^0+$/.test(BASE_SHA);
  const range = empty ? `${HEAD_SHA}~1...${HEAD_SHA}` : `${BASE_SHA}...${HEAD_SHA}`;
  const full = execFileSync("git", ["diff", range, "--", ".", ...OMITTED.map((f) => `:!${f}`)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const omitted = omittedNote(execFileSync("git", ["diff", "--numstat", range, "--", ...OMITTED], { encoding: "utf8" }));
  if (!full.trim()) return console.log("差分がないため、AIのレビューを飛ばしました");
  const history = reviewHistory(await pastComments());
  const { input, cut } = reviewInput({ prBody: PR_BODY, history, omitted, diff: full });
  const text = await askReviewer(REVIEWER, reviewInstructions({ autoPr: false, withHistory: !!history }), input, { openai: OPENAI_API_KEY, gemini: GEMINI_API_KEY });
  const r = parseReview(REVIEWER, text, cut);
  await comment(reviewComment(r, "参考意見です。デプロイは止めません。採用するかは人が判断します。", !!history));
  const findings = r.findings;
  console.log(`指摘 ${findings.length}件をコメントしました`);
}

main().catch((e) => {
  // レビューの失敗でCIを落とさない
  console.error(e instanceof Error ? e.message : e);
});
