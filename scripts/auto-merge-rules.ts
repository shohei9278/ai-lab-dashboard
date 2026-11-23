// 自動マージの決まり（scripts/auto-merge.ts から使う。GitHub や AI を呼ばない、確かめやすい部分だけ）
// 対象は、提案箱から頼んで、クラウドの Claude Code（ルーティン）が作った PR（claude/proposal-<番号>）だけ（運営者が決めた）
// マージしてよいかは、見回り（main のコード）が自分で呼んだ GPT と Gemini のレビューの答えだけで決める
// PR のコメントは誰でも（PR の中の workflow も、ボットとして）書けるので、「指摘なし」のような、マージに進む方向の判断には使わない（PR #153 の ai-review の指摘）
// コメントの印は、止める方向（人に回した・この版の直しは頼んだ）にだけ使う。偽物でも、止まるだけで、マージはされない
import { blocking, findingLine, REVIEWERS, type Finding, type Review, type Reviewer } from "./ai-review-core";

export const AUTO_BRANCH = /^claude\/proposal-(\d+)$/;
export const MAX_FIX_ROUNDS = 3; // ルーティンに直させるのは、この回数まで。超えたら人に回す

// 自動ではマージしない所（自動マージの仕組み自体を、AIが書き換えられないように・壊れたときの被害が大きい所）
export const PROTECTED: RegExp[] = [
  /^\.github\//, // CI・本番の確認・自動マージ
  /^scripts\/(ai-review|auto-merge)/, // レビューと自動マージ
  /^src\/proxy\.ts$/, // 来訪者の入口
  /^src\/lib\/(ai|budget|autopilot|codeReview|routine|aiFix|toolRoutine|autoAsk)\.ts$/, // 予算・緊急停止・合言葉・ルーティンの起動
  /^src\/lib\/viewer\.ts$/, // 来訪者に見せない仕組み
  /^src\/lib\/interventions\.ts$/, // 人の手の記録
  /^src\/app\/api\/(code-review|tool-jobs|login|settings)\//, // 合言葉の入口・ログイン・設定
  /^package(-lock)?\.json$/, /^lp-site\/package(-lock)?\.json$/, // 依存の追加
  /^docs\/routine-/, // ルーティンへの指示
  /^CLAUDE\.md$/, /^AGENTS\.md$/,
];
export const protectedFiles = (files: string[]) => files.filter((f) => PROTECTED.some((re) => re.test(f)));
// PR の変えたファイル（GitHub の files API の1件）。名前を変えたときは、前の名前も見る（危ない所から外へ名前を変えて、見張りをすり抜けないように）
export const changedPaths = (files: { filename: string; previous_filename?: string }[]) => files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));

export type PrComment = { body?: string; user?: { login?: string } | null };
const REVIEW_BOT = "github-actions[bot]";
const bot = (c: PrComment) => c.user?.login === REVIEW_BOT && !!c.body;

// これまでにルーティンに直させた回数（自動マージが書くコメントの印を数える）。印には、直させたときの版（sha）を入れる
const FIX_MARK = "<!-- auto-merge fix ";
export const fixMarker = (sha: string) => `${FIX_MARK}${sha} -->`;
export const fixRounds = (comments: PrComment[]) => comments.filter((c) => bot(c) && c.body!.includes(FIX_MARK)).length;
// この版で、もう直しを頼んだか（定期の見回りで、同じ版の直しを何度も頼まない）
export const fixRequested = (comments: PrComment[], sha: string) => comments.some((c) => bot(c) && c.body!.includes(fixMarker(sha)));
// 人に回したことの印（同じ PR で何度も知らせない）
export const HUMAN_MARK = "<!-- auto-merge human -->";
export const handedToHuman = (comments: PrComment[]) => comments.some((c) => bot(c) && c.body!.includes(HUMAN_MARK));

// 見回りが書いたレビューの印。次の版のレビューに「前の版への指摘（直ったかを確かめる項目）」として渡す（PR #153 の ai-review の指摘）
// 偽物が混じっても、確かめる項目が増えるだけで、マージに進む方向には働かない（「直った」「判断済み」の言葉は根拠にしないよう AI に伝える）
// 本物は、最初のレビューと3回直したあとのレビューで、2社×4回の8件まで。それより多い・長いときは、全部を渡せないので人に回す（偽物で本物を押し出させない）
const REVIEW_MARK = "<!-- auto-merge review ";
export const reviewMarker = (reviewer: string, sha: string) => `${REVIEW_MARK}${reviewer} ${sha} -->`;
// 同じ版のレビューは1回だけ書く（マージの直前の見直しで待ったときなど、同じ版をもう一度レビューしても、記録を増やさない）
export const reviewPosted = (comments: PrComment[], reviewer: string, sha: string) => comments.some((c) => bot(c) && c.body!.includes(reviewMarker(reviewer, sha)));
export const HISTORY_MAX_COMMENTS = 2 * (MAX_FIX_ROUNDS + 1);
export const HISTORY_MAX_CHARS = 30_000;
export function reviewHistory(comments: PrComment[]): { text: string; ok: boolean } {
  const past = comments.filter((c) => bot(c) && c.body!.includes(REVIEW_MARK)).map((c) => c.body!);
  const text = past.length ? `前の版へのレビュー（直ったかを確かめる項目）:\n\n${past.join("\n\n---\n\n")}` : "";
  return { text, ok: past.length <= HISTORY_MAX_COMMENTS && text.length <= HISTORY_MAX_CHARS };
}

// レビューを頼めなかった（通信の失敗・モデルの廃止など）ことの印。同じ版で3回頼めなかったら、人に回す（いつまでも待たない。PR #153 の ai-review の指摘）
// 偽物が混じっても、早く人に回るだけで、マージはされない
export const MAX_REVIEW_FAILS = 3;
const REVIEW_FAIL_MARK = "<!-- auto-merge review-failed ";
export const reviewFailMarker = (sha: string) => `${REVIEW_FAIL_MARK}${sha} -->`;
export const reviewFailures = (comments: PrComment[], sha: string) => comments.filter((c) => bot(c) && c.body!.includes(reviewFailMarker(sha))).length;

// ルーティンの起動の応答のうち、「届いていない」とはっきり分かるもの（4xx。ただし 408・429 は、届いたか分からない側）
// 5xx・408・429 は、受け付けたあとに失敗したこともありうるので、印を残して、人に確かめてもらう（PR #153 の ai-review の指摘）
export const fireRejected = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429;

// main の本番の確認（smoke.yml）の、いちばん新しい結果。新しい順の一覧を渡す
// いちばん新しいものが動いている途中なら、分からない（null）として待つ（出した直後の、まだ確かめていない本番の上でマージしない。PR #153 の ai-review の指摘）
// 取り消し・飛ばしは結果ではないので、その前のものを見る
export type SmokeRun = { status: string; conclusion: string | null };
export function smokeResult(runs: SmokeRun[]): boolean | null {
  for (const r of runs) {
    if (r.status !== "completed") return null;
    if (r.conclusion === "skipped" || r.conclusion === "cancelled") continue;
    return r.conclusion === "success";
  }
  return null;
}

export type Decision = { action: "merge" | "fix" | "human" | "wait" | "review"; reason: string };

// レビューの前に決められること。"review" なら、レビューしてから afterReview で決める
// レビューは、ほかの条件が全部そろってから1回だけ呼ぶ（AIの費用を、マージできない間に使わない）
export function beforeReview(x: {
  branch: string; sameRepo: boolean; baseMain: boolean; draft: boolean; checksDone: boolean; ciOk: boolean;
  files: string[]; filesComplete: boolean; commentsComplete: boolean; historyOk: boolean; fixRequestedNow: boolean;
  productionIdle: boolean | null; smokeOk: boolean | null;
}): Decision {
  if (!AUTO_BRANCH.test(x.branch) || !x.sameRepo) return { action: "wait", reason: "ルーティンが作った PR ではない" };
  // main 向けの PR だけ（レビューは main との差分で見るので、ほかのブランチへのマージはしない。PR #153 の ai-review の指摘）
  if (!x.baseMain) return { action: "wait", reason: "main 向けの PR ではない" };
  if (x.draft) return { action: "wait", reason: "下書きの PR" };
  if (!x.checksDone) return { action: "wait", reason: "CI が終わっていない" };
  if (x.fixRequestedNow) return { action: "wait", reason: "この版の直しは頼んだ" };
  // 変えたファイル・コメントを全部読めなかったときは、見落としがありうるので人に回す（PR #153 の ai-review の指摘）
  if (!x.filesComplete) return { action: "human", reason: "変えたファイルが多すぎて、全部を確かめられない" };
  if (!x.commentsComplete) return { action: "human", reason: "コメントが多すぎて、全部を読めない" };
  if (!x.historyOk) return { action: "human", reason: "前の版へのレビューが多すぎて、次のレビューに全部を渡せない" };
  const prot = protectedFiles(x.files);
  if (prot.length) return { action: "human", reason: `自動ではマージしない所に触れている（${prot.slice(0, 5).join("・")}）` };
  if (!x.ciOk) return { action: "human", reason: "CI が通っていない" };
  if (x.smokeOk === false) return { action: "wait", reason: "本番の確認がいま失敗しているので、自動マージを止めている" };
  if (x.smokeOk !== true) return { action: "wait", reason: "本番の確認の結果が分からない" };
  if (x.productionIdle !== true) return { action: "wait", reason: x.productionIdle === false ? "本番が作業中" : "本番が止まっているか分からない" };
  return { action: "review", reason: "GPT と Gemini にレビューを頼む" };
}

export function afterReview(reviews: Partial<Record<Reviewer, Review>>, fixes: number): Decision {
  const missing = REVIEWERS.filter((r) => !reviews[r]?.parsed);
  if (missing.length) return { action: "human", reason: `レビューの答えを読めなかった（${missing.join("・")}）` };
  if (REVIEWERS.some((r) => reviews[r]!.cut)) return { action: "human", reason: "差分が長く、レビューが途中までしか読めていない" };
  const n = REVIEWERS.reduce((a, r) => a + blocking(reviews[r]!).length, 0);
  if (n > 0) {
    if (fixes >= MAX_FIX_ROUNDS) return { action: "human", reason: `${MAX_FIX_ROUNDS}回直しても、直すべき指摘（🔴・🟡）が${n}件残っている` };
    return { action: "fix", reason: `直すべき指摘（🔴・🟡）が${n}件ある（${fixes + 1}回目の直し）` };
  }
  return { action: "merge", reason: "CI が通り、GPT と Gemini のどちらも直すべき指摘なし" };
}

// ルーティンに渡す文。指摘は1件ずつ丸ごと入れ、全部が入りきらないときは null（途中で切って渡さない。人に回す）
export const FIX_TEXT_MAX = 20_000;
export function fixText(pr: { number: number; title: string; head: { ref: string; sha: string } }, findings: Finding[]): string | null {
  const text = [
    "レビューの指摘を直す",
    `PR #${pr.number}: ${pr.title}`,
    `ブランチ: ${pr.head.ref}`,
    `直す版: ${pr.head.sha}`,
    `直す指摘（この版への GPT と Gemini のレビューの 🔴・🟡。${findings.length}件）:`,
    ...findings.map(findingLine),
  ].join("\n");
  return text.length <= FIX_TEXT_MAX ? text : null;
}
