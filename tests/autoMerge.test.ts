import assert from "node:assert/strict";
import { test } from "node:test";
import { FIX_TEXT_MAX, blockingFindings, changedPaths, decide, fixMarker, fixText, fixRequested, fixRounds, handedToHuman, HUMAN_MARK, protectedFiles, reviewMarker, reviewMarks, type PrComment } from "../scripts/auto-merge-rules";

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
  assert.equal(base(ok, { smokeOk: null }).action, "wait");
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

test("自動マージ: 名前を変えたファイルは前の名前も見る（危ない所から外へ名前を変えて、すり抜けない）", () => {
  const paths = changedPaths([{ filename: "src/lib/helper.ts", previous_filename: "src/lib/ai.ts" }, { filename: "src/lib/loop.ts" }]);
  assert.deepEqual(paths, ["src/lib/helper.ts", "src/lib/ai.ts", "src/lib/loop.ts"]);
  assert.equal(base([review("gpt", []), review("gemini", [])], { files: paths }).action, "human");
});

test("自動マージ: 重さが書かれていない・形のおかしい指摘は 🔴 として数える", () => {
  const m = (findings: unknown[]) => reviewMarks([bot(reviewMarker({ reviewer: "gpt", sha: SHA, parsed: true, cut: false, findings }))], SHA).gpt!;
  assert.equal(m([{}]).high, 1);
  assert.equal(m(["文字だけ"]).high, 1);
  assert.equal(m([{ severity: "low" }]).high, 0);
});

test("自動マージ: ルーティンには 🔴・🟡 の指摘だけを、説明ごと抜き出して渡す（長いレビューでも後ろの指摘を落とさない）", () => {
  const body = ["### 別のAI（gpt）のレビュー", "全体の所感".repeat(500), "- ⚪ `a.ts` 細かい", "  - 理由", "- 🔴 `b.ts:3` 大事な問題", "  - 起きること", "  - 直し方: こうする", "- 🟡 `c.ts` 次の問題", "  - 理由2", "", "<!-- ai-review {} -->"].join("\n");
  assert.deepEqual(blockingFindings(body), ["- 🔴 `b.ts:3` 大事な問題\n  - 起きること\n  - 直し方: こうする", "- 🟡 `c.ts` 次の問題\n  - 理由2"]);
});

test("自動マージ: ルーティンに渡す文は、指摘を1件ずつ丸ごと入れ、入りきらなければ渡さない", () => {
  const pr = { number: 9, title: "t", head: { ref: "claude/proposal-9", sha: SHA } };
  const short = ["- 🔴 `a.ts` 問題\n  - 理由"].join("\n");
  assert.match(fixText(pr, [short])!, /直す指摘（この版へのレビューの 🔴・🟡。1件）:\n- 🔴 `a.ts` 問題\n  - 理由$/);
  const long = `- 🟡 \`b.ts\` ${"長い".repeat(FIX_TEXT_MAX)}`;
  assert.equal(fixText(pr, [long]), null);
});

