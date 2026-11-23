import assert from "node:assert/strict";
import { test } from "node:test";
import { FIX_TEXT_MAX, HISTORY_MAX_COMMENTS, HUMAN_MARK, afterReview, beforeReview, changedPaths, fireRejected, fixMarker, fixRequested, fixRounds, fixText, handedToHuman, protectedFiles, reviewHistory, reviewMarker, reviewPosted, type PrComment } from "../scripts/auto-merge-rules";
import { parseReview, reviewInstructions, type Review } from "../scripts/ai-review-core";

// 自動マージの決まり: ルーティンが作った PR を、マージ・直させる・人に回す・待つ、のどれにするか
// マージに進む判断は、見回りが自分で呼んだレビューの答えだけで決める（PR のコメントの「指摘なし」は信じない）

const SHA = "abc123";
const bot = (body: string): PrComment => ({ body, user: { login: "github-actions[bot]" } });
const pre = (o: Partial<Parameters<typeof beforeReview>[0]> = {}) => beforeReview({
  branch: "claude/proposal-90", sameRepo: true, baseMain: true, draft: false, checksDone: true, ciOk: true, files: ["src/lib/loop.ts"],
  filesComplete: true, commentsComplete: true, historyOk: true, fixRequestedNow: false, productionIdle: true, smokeOk: true, ...o,
});
const rv = (reviewer: "gpt" | "gemini", severities: string[], o: { parsed?: boolean; cut?: boolean } = {}): Review =>
  o.parsed === false ? { reviewer, summary: "", findings: [], parsed: false, cut: !!o.cut }
    : parseReview(reviewer, JSON.stringify({ summary: "s", findings: severities.map((severity, i) => ({ file: `f${i}.ts`, severity, issue: "問題", why: "理由" })) }), !!o.cut);

test("自動マージ: ほかの条件がそろったら、レビューを頼む。GPT と Gemini のどちらも直すべき指摘なしならマージ（⚪ だけなら止めない）", () => {
  assert.equal(pre().action, "review");
  assert.equal(afterReview({ gpt: rv("gpt", ["low"]), gemini: rv("gemini", []) }, 0).action, "merge");
});

test("自動マージ: 直すべき指摘があれば直させ、3回直しても残れば人に回す。同じ版の直しは二度頼まない", () => {
  const r = { gpt: rv("gpt", ["medium", "low"]), gemini: rv("gemini", ["high"]) };
  assert.deepEqual(afterReview(r, 0), { action: "fix", reason: "直すべき指摘（🔴・🟡）が2件ある（1回目の直し）" });
  const tried = [bot(fixMarker("old1")), bot(fixMarker("old2")), bot(fixMarker("old3"))];
  assert.equal(afterReview(r, fixRounds(tried)).action, "human");
  assert.equal(fixRequested([bot(fixMarker(SHA))], SHA), true);
  assert.equal(fixRequested([bot(fixMarker("other"))], SHA), false);
  assert.equal(pre({ fixRequestedNow: true }).action, "wait");
});

test("自動マージ: 自動で触れない所・CI の失敗・全部を読めないとき・レビューの答えを読めないとき・途中までのときは人に回す", () => {
  assert.match(pre({ files: ["src/lib/loop.ts", ".github/workflows/ci.yml"] }).reason, /\.github\/workflows\/ci\.yml/);
  for (const f of ["src/proxy.ts", "src/lib/ai.ts", "src/lib/autopilot.ts", "src/lib/autoAsk.ts", "scripts/auto-merge-rules.ts", "scripts/ai-review-core.ts", "src/lib/interventions.ts", "package.json", "docs/routine-proposal-fix.md", "CLAUDE.md"]) {
    assert.equal(pre({ files: [f] }).action, "human", f);
  }
  assert.deepEqual(protectedFiles(["src/lib/loop.ts", "src/app/page.tsx", "tests/x.test.ts"]), []);
  assert.equal(pre({ ciOk: false }).action, "human");
  assert.equal(pre({ filesComplete: false }).action, "human");
  assert.equal(pre({ commentsComplete: false }).action, "human");
  assert.equal(pre({ historyOk: false }).action, "human");
  assert.equal(afterReview({ gpt: rv("gpt", []) }, 0).action, "human");
  assert.equal(afterReview({ gpt: rv("gpt", []), gemini: rv("gemini", [], { parsed: false }) }, 0).action, "human");
  assert.equal(afterReview({ gpt: rv("gpt", []), gemini: rv("gemini", [], { cut: true }) }, 0).action, "human");
});

test("自動マージ: CI が終わっていない・本番が作業中・止まっているか分からない・本番の確認が失敗か分からないときは待つ。ルーティンの PR でなければ何もしない", () => {
  for (const o of [{ checksDone: false }, { productionIdle: false }, { productionIdle: null }, { smokeOk: false }, { smokeOk: null }, { branch: "feat/x" }, { sameRepo: false }, { baseMain: false }, { draft: true }]) {
    assert.equal(pre(o).action, "wait", JSON.stringify(o));
  }
});

test("自動マージ: 名前を変えたファイルは前の名前も見る（危ない所から外へ名前を変えて、すり抜けない）", () => {
  const paths = changedPaths([{ filename: "src/lib/helper.ts", previous_filename: "src/lib/ai.ts" }, { filename: "src/lib/loop.ts" }]);
  assert.deepEqual(paths, ["src/lib/helper.ts", "src/lib/ai.ts", "src/lib/loop.ts"]);
  assert.equal(pre({ files: paths }).action, "human");
});

test("レビューの答え: 中身が欠けている・重さが分からない・オブジェクトでない指摘は、重さに関係なく 🔴 として数える", () => {
  const r = parseReview("gpt", JSON.stringify({ summary: "s", findings: [{ severity: "low" }, "文字だけ", { file: "a.ts", issue: "x", why: "y", severity: "critical" }, { file: "b.ts", issue: "x", why: "y", severity: "low" }] }), false);
  assert.deepEqual(r.findings.map((f) => f.severity), ["high", "high", "high", "low"]);
  assert.equal(parseReview("gpt", "読めない", false).parsed, false);
  assert.equal(parseReview("gpt", JSON.stringify({ summary: "s" }), false).parsed, false);
});

test("自動マージ: ルーティンに渡す文は、指摘を1件ずつ丸ごと入れ、入りきらなければ渡さない", () => {
  const pr = { number: 9, title: "t", head: { ref: "claude/proposal-9", sha: SHA } };
  const f = rv("gpt", ["high"]).findings;
  assert.match(fixText(pr, f)!, /🔴・🟡。1件）:\n- 🔴 `f0.ts` 問題\n  - 理由$/);
  assert.equal(fixText(pr, [{ ...f[0], issue: "長い".repeat(FIX_TEXT_MAX) }]), null);
});

test("自動マージ: 人に回した印は、ボットのコメントだけを読む（止める方向にだけ使う）", () => {
  assert.equal(handedToHuman([bot(`人に回します ${HUMAN_MARK}`)]), true);
  assert.equal(handedToHuman([{ body: HUMAN_MARK, user: { login: "someone" } }]), false);
});

test("自動マージ: 見回りが書いた前の版へのレビューを、次のレビューに「直ったかを確かめる項目」として渡す。多すぎるときは渡せないとする", () => {
  const mine = bot(`### レビュー\n- 🔴 a.ts 問題\n\n${reviewMarker("gpt", "old1")}`);
  const h = reviewHistory([mine, { body: reviewMarker("gpt", "x"), user: { login: "someone" } }, bot("ほかのコメント")]);
  assert.equal(h.ok, true);
  assert.match(h.text, /^前の版へのレビュー（直ったかを確かめる項目）:\n\n### レビュー\n- 🔴 a.ts 問題/);
  assert.doesNotMatch(h.text, /reviewMarker|ほかのコメント/);
  assert.deepEqual(reviewHistory([]), { text: "", ok: true });
  assert.equal(reviewHistory(Array.from({ length: HISTORY_MAX_COMMENTS + 1 }, (_, i) => bot(reviewMarker("gpt", `s${i}`)))).ok, false);
  assert.equal(reviewPosted([mine], "gpt", "old1"), true);
  assert.equal(reviewPosted([mine], "gemini", "old1"), false);
  assert.match(reviewInstructions({ autoPr: true, withHistory: false, recheck: true }), /直っているかを1件ずつ確かめ/);
  assert.doesNotMatch(reviewInstructions({ autoPr: true, withHistory: false }), /前の版へのレビュー/);
});

test("自動マージ: ルーティンの起動ではっきり断られたのは 4xx だけ（408・429・5xx は届いたか分からないので、直しの印を残す）", () => {
  for (const s of [400, 401, 403, 404, 422]) assert.equal(fireRejected(s), true, String(s));
  for (const s of [408, 429, 500, 502, 503]) assert.equal(fireRejected(s), false, String(s));
});
