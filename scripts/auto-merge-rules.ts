// 自動マージの決まり（scripts/auto-merge.ts と ai-review.ts から使う。GitHub や AI を呼ばない、確かめやすい部分だけ）
// 対象は、提案箱から頼んで、クラウドの Claude Code（ルーティン）が作った PR（claude/proposal-<番号>）だけ（運営者が決めた）

export const AUTO_BRANCH = /^claude\/proposal-(\d+)$/;
export const REVIEWERS = ["gpt", "gemini"] as const;
export type Reviewer = (typeof REVIEWERS)[number];
export const MAX_FIX_ROUNDS = 3; // ルーティンに直させるのは、この回数まで。超えたら人に回す

// 自動ではマージしない所（自動マージの仕組み自体を、AIが書き換えられないように・壊れたときの被害が大きい所）
export const PROTECTED: RegExp[] = [
  /^\.github\//, // CI・本番の確認・自動マージ
  /^scripts\/(ai-review|auto-merge)/, // レビューと自動マージ
  /^src\/proxy\.ts$/, // 来訪者の入口
  /^src\/lib\/(ai|budget|autopilot|codeReview|routine|aiFix|toolRoutine)\.ts$/, // 予算・緊急停止・合言葉・ルーティンの起動
  /^src\/lib\/viewer\.ts$/, // 来訪者に見せない仕組み
  /^src\/lib\/interventions\.ts$/, // 人の手の記録
  /^src\/app\/api\/(code-review|tool-jobs|login|settings)\//, // 合言葉の入口・ログイン・設定
  /^package(-lock)?\.json$/, /^lp-site\/package(-lock)?\.json$/, // 依存の追加
  /^docs\/routine-/, // ルーティンへの指示
  /^CLAUDE\.md$/, /^AGENTS\.md$/,
];
export const protectedFiles = (files: string[]) => files.filter((f) => PROTECTED.some((re) => re.test(f)));
// PR の変えたファイル（GitHub の files API の1件）。名前を変えたときは、前の名前も見る（危ない所から外へ名前を変えて、見張りをすり抜けないように。PR #153 の ai-review の指摘）
export const changedPaths = (files: { filename: string; previous_filename?: string }[]) => files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));

// レビューのコメントの最後に付ける印（自動マージが読む）
export type ReviewMark = { reviewer: Reviewer; sha: string; parsed: boolean; cut: boolean; high: number; medium: number; low: number };
const MARK = "<!-- ai-review ";
export function reviewMarker(r: { reviewer: Reviewer; sha: string; parsed: boolean; cut: boolean; findings: unknown[] }): string {
  const sev = (f: unknown) => (typeof f === "object" && f !== null ? (f as { severity?: unknown }).severity : undefined);
  const n = (s: string) => r.findings.filter((f) => sev(f) === s).length;
  // 重さが書かれていない・知らない重さ・形のおかしい指摘は、いちばん重いものとして数える（読み違えて見逃さないように。PR #153 の ai-review の指摘）
  const unknown = r.findings.filter((f) => !["high", "medium", "low"].includes(String(sev(f)))).length;
  const m: ReviewMark = { reviewer: r.reviewer, sha: r.sha, parsed: r.parsed, cut: r.cut, high: n("high") + unknown, medium: n("medium"), low: n("low") };
  return `${MARK}${JSON.stringify(m)} -->`;
}

export type PrComment = { body?: string; user?: { login?: string } | null };
const REVIEW_BOT = "github-actions[bot]";

// PR のコメントから、この版（sha）への各レビューの印を読む（同じ AI が何度も書いていたら、最後のもの）
// ボットのコメントだけを読む（誰でもコメントできる公開リポジトリなので、印を装えないように）
export function reviewMarks(comments: PrComment[], sha: string): Partial<Record<Reviewer, ReviewMark>> {
  const out: Partial<Record<Reviewer, ReviewMark>> = {};
  for (const c of comments) {
    if (c.user?.login !== REVIEW_BOT || !c.body) continue;
    const i = c.body.lastIndexOf(MARK);
    if (i < 0) continue;
    try {
      const m = JSON.parse(c.body.slice(i + MARK.length, c.body.indexOf(" -->", i))) as ReviewMark;
      if (m.sha === sha && (REVIEWERS as readonly string[]).includes(m.reviewer)) out[m.reviewer] = m;
    } catch {
      // 壊れた印は読まない
    }
  }
  return out;
}

// これまでにルーティンに直させた回数（自動マージが書くコメントの印を数える）。印には、直させたときの版（sha）を入れる
const FIX_MARK = "<!-- auto-merge fix ";
export const fixMarker = (sha: string) => `${FIX_MARK}${sha} -->`;
const bot = (c: PrComment) => c.user?.login === REVIEW_BOT && !!c.body;
export const fixRounds = (comments: PrComment[]) => comments.filter((c) => bot(c) && c.body!.includes(FIX_MARK)).length;
// この版で、もう直しを頼んだか（定期の見回りで、同じ版の直しを何度も頼まない）
export const fixRequested = (comments: PrComment[], sha: string) => comments.some((c) => bot(c) && c.body!.includes(fixMarker(sha)));
// 人に回したことの印（同じ PR で何度も知らせない）
export const HUMAN_MARK = "<!-- auto-merge human -->";
export const handedToHuman = (comments: PrComment[]) => comments.some((c) => bot(c) && c.body!.includes(HUMAN_MARK));

export type Decision = { action: "merge" | "fix" | "human" | "wait"; reason: string };

export function decide(x: {
  branch: string; sameRepo: boolean; draft: boolean; ciOk: boolean; files: string[];
  marks: Partial<Record<Reviewer, ReviewMark>>; fixes: number; productionIdle: boolean | null; smokeOk: boolean | null;
}): Decision {
  if (!AUTO_BRANCH.test(x.branch) || !x.sameRepo) return { action: "wait", reason: "ルーティンが作った PR ではない" };
  if (x.draft) return { action: "wait", reason: "下書きの PR" };
  const prot = protectedFiles(x.files);
  if (prot.length) return { action: "human", reason: `自動ではマージしない所に触れている（${prot.slice(0, 5).join("・")}）` };
  if (!x.ciOk) return { action: "human", reason: "CI が通っていない" };
  const missing = REVIEWERS.filter((r) => !x.marks[r]?.parsed);
  if (missing.length) return { action: "human", reason: `この版のレビューがそろっていない（${missing.join("・")}）` };
  if (REVIEWERS.some((r) => x.marks[r]!.cut)) return { action: "human", reason: "差分が長く、レビューが途中までしか読めていない" };
  const blocking = REVIEWERS.reduce((n, r) => n + x.marks[r]!.high + x.marks[r]!.medium, 0);
  if (blocking > 0) {
    if (x.fixes >= MAX_FIX_ROUNDS) return { action: "human", reason: `${MAX_FIX_ROUNDS}回直しても、直すべき指摘（🔴・🟡）が${blocking}件残っている` };
    return { action: "fix", reason: `直すべき指摘（🔴・🟡）が${blocking}件ある（${x.fixes + 1}回目の直し）` };
  }
  if (x.smokeOk === false) return { action: "wait", reason: "本番の確認がいま失敗しているので、自動マージを止めている" };
  // 本番の確認の結果が取れないときも待つ（分からないままマージしない。PR #153 の ai-review の指摘）
  if (x.smokeOk !== true) return { action: "wait", reason: "本番の確認の結果が分からない" };
  if (x.productionIdle !== true) return { action: "wait", reason: x.productionIdle === false ? "本番が作業中" : "本番が止まっているか分からない" };
  return { action: "merge", reason: "CI が通り、GPT と Gemini のどちらも直すべき指摘なし" };
}

// 指摘は、🔴・🟡 の行とその下の説明だけを抜き出して渡す（前は先頭3000文字で切っていて、後ろの指摘が渡らないことがあった。PR #153 の ai-review の指摘）
export function blockingFindings(body: string): string[] {
  const out: string[] = [];
  let cur: string[] | null = null;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    if (/^- [🔴🟡⚪]/u.test(line)) {
      cur = /^- [🔴🟡]/u.test(line) ? [line] : null;
      if (cur) out.push("");
    } else if (cur && /^\s+- /.test(line)) cur.push(line);
    else cur = null;
    if (cur) out[out.length - 1] = cur.join("\n");
  }
  return out.filter(Boolean);
}

// ルーティンに渡す文。指摘は1件ずつ丸ごと入れ、全部が入りきらないときは null（途中で切って渡さない。人に回す。PR #153 の ai-review の指摘）
export const FIX_TEXT_MAX = 20_000;
export function fixText(pr: { number: number; title: string; head: { ref: string; sha: string } }, reviews: string[]): string | null {
  const findings = reviews.flatMap(blockingFindings);
  const text = [
    "レビューの指摘を直す",
    `PR #${pr.number}: ${pr.title}`,
    `ブランチ: ${pr.head.ref}`,
    `直す版: ${pr.head.sha}`,
    `直す指摘（この版へのレビューの 🔴・🟡。${findings.length}件）:`,
    ...findings,
  ].join("\n");
  return text.length <= FIX_TEXT_MAX ? text : null;
}

