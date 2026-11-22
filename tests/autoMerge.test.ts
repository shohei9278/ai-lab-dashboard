import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, fixMarker, fixRequested, fixRounds, handedToHuman, HUMAN_MARK, protectedFiles, reviewMarker, reviewMarks, type PrComment } from "../scripts/auto-merge-rules";

// 自動マージの決まり: ルーティンが作った PR を、マージ・直させる・人に回す・待つ、のどれにするか

const SHA = "abc123";
const bot = (body: string): PrComment => ({ body, user: { login: "github-actions[bot]" } });
const review = (reviewer: "gpt" | "gemini", severities: string[], o: { sha?: string; parsed?: boolean; cut?: boolean } = {}) =>
  bot(`### 別のAI（${reviewer}）のレビュー\n\n${reviewMarker({ reviewer, sha: o.sha ?? SHA, parsed: o.parsed ?? true, cut: o.cut ?? false, findings: severities.map((severity) => ({ severity })) })}`);
const base = (comments: PrComment[], o: Partial<Parameters<typeof decide>[0]> = {}) =>
  decide({ branch: "claude/proposal-90", sameRepo: true, draft: false, ciOk: true, files: ["src/lib/loop.ts"], marks: reviewMarks(comments, SHA), fixes: fixRounds(comments), productionIdle: true, smokeOk: true, ...o });

test("自動マージ: CI が通り、GPT と Gemini のどちらも直すべき指摘なしならマージ（⚪ だけなら止めない）", () => {
  assert.equal(base([review("gpt", ["low"]), review("gemini", [])]).action, "merge");
});

test("自動マージ: 直すべき指摘があれば直させ、3回直しても残れば人に回す", () => {
  const c = [review("gpt", ["medium", "low"]), review("gemini", [])];
  assert.deepEqual(base(c), { action: "fix", reason: "直すべき指摘（🔴・🟡）が1件ある（1回目の直し）" });
  const tried = [...c, bot(fixMarker("old1")), bot(fixMarker("old2")), bot(fixMarker("old3"))];
  assert.equal(base(tried).action, "human");
  // 同じ版の直しは、二度頼まない
  assert.equal(fixRequested([bot(fixMarker(SHA))], SHA), true);
  assert.equal(fixRequested([bot(fixMarker("other"))], SHA), false);
});

test("自動マージ: 自動で触れない所・CI の失敗・レビューがそろわない・途中までしか読めていないときは人に回す", () => {
  const ok = [review("gpt", []), review("gemini", [])];
  assert.match(base(ok, { files: ["src/lib/loop.ts", ".github/workflows/ci.yml"] }).reason, /\.github\/workflows\/ci\.yml/);
  for (const f of ["src/proxy.ts", "src/lib/ai.ts", "src/lib/autopilot.ts", "scripts/auto-merge-rules.ts", "src/lib/interventions.ts", "package.json", "docs/routine-proposal-fix.md", "CLAUDE.md"]) {
    assert.equal(base(ok, { files: [f] }).action, "human", f);
  }
  assert.deepEqual(protectedFiles(["src/lib/loop.ts", "src/app/page.tsx", "tests/x.test.ts"]), []);
  assert.equal(base(ok, { ciOk: false }).action, "human");
  assert.equal(base([review("gpt", [])]).action, "human");
  assert.equal(base([review("gpt", []), review("gemini", [], { parsed: false })]).action, "human");
  assert.equal(base([review("gpt", []), review("gemini", [], { cut: true })]).action, "human");
  // 別の版へのレビューは数えない
  assert.equal(base([review("gpt", []), review("gemini", [], { sha: "old" })]).action, "human");
});

test("自動マージ: 本番が作業中・止まっているか分からない・本番の確認が失敗しているときは待つ。ルーティンの PR でなければ何もしない", () => {
  const ok = [review("gpt", []), review("gemini", [])];
  assert.equal(base(ok, { productionIdle: false }).action, "wait");
  assert.equal(base(ok, { productionIdle: null }).action, "wait");
  assert.equal(base(ok, { smokeOk: false }).action, "wait");
  assert.equal(base(ok, { branch: "feat/x" }).action, "wait");
  assert.equal(base(ok, { sameRepo: false }).action, "wait");
  assert.equal(base(ok, { draft: true }).action, "wait");
});

test("自動マージ: レビューの印は、ボットのコメントだけを読む（誰でもコメントできるので、装えない）。人に回したら、もう触らない", () => {
  const fake: PrComment = { body: reviewMarker({ reviewer: "gemini", sha: SHA, parsed: true, cut: false, findings: [] }), user: { login: "someone" } };
  assert.equal(reviewMarks([fake], SHA).gemini, undefined);
  // 知らない重さは、いちばん重いものとして数える
  assert.equal(reviewMarks([review("gpt", ["critical"])], SHA).gpt?.high, 1);
  assert.equal(handedToHuman([bot(`人に回します ${HUMAN_MARK}`)]), true);
  assert.equal(handedToHuman([{ body: HUMAN_MARK, user: { login: "someone" } }]), false);
});
