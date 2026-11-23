import assert from "node:assert/strict";
import { test } from "node:test";
import { decideRevert, mainSmokeRuns, revertBranch, type MainTip, type SmokeRun } from "../scripts/auto-revert-rules";
import { protectedFiles } from "../scripts/auto-merge-rules";

// ダッシュボードの自動の戻し: マージの直後に本番の確認が2回続けて失敗し、その前の版で成功していたときだけ、元に戻す

const P = "p".repeat(40), T = "t".repeat(40), X = "x".repeat(40);
const tip = (o: Partial<MainTip> = {}): MainTip => ({ sha: T, parents: [P, X], message: "Merge pull request #170 from shohei9278/claude/proposal-99\n\n題", ...o });
const run = (conclusion: string, head_sha: string): SmokeRun => ({ conclusion, head_sha });
const ok: SmokeRun[] = [run("failure", T), run("failure", T), run("success", P)];

test("自動の戻し: マージのあと2回続けて失敗し、直前の版で成功していたら、そのマージを元に戻す", () => {
  const d = decideRevert({ runs: ok, tip: tip(), revertedToday: false });
  assert.deepEqual(d, { action: "revert", merge: T, pr: 170, reason: "マージ（PR #170）のあと、本番の確認が2回続けて失敗し、その前の版では成功していた" });
  assert.equal(revertBranch(T), "auto-revert/tttttttttttt");
});

test("自動の戻し: 1回だけの失敗・3回目からの失敗では何もしない（決めるのは2回続けて失敗したときの1回だけ）", () => {
  assert.equal(decideRevert({ runs: [run("failure", T), run("success", P)], tip: tip(), revertedToday: false }).action, "none");
  assert.equal(decideRevert({ runs: [run("failure", T), run("failure", T), run("failure", T)], tip: tip(), revertedToday: false }).action, "none");
});

test("自動の戻し: コードのせいと言えないとき・1日に2回目のときは、戻さずに人に回す", () => {
  for (const [why, x] of [
    ["同じ版で前は成功", { runs: [run("failure", T), run("failure", T), run("success", T)], tip: tip(), revertedToday: false }],
    ["あいだに別の変更", { runs: [run("failure", T), run("failure", T), run("success", X)], tip: tip(), revertedToday: false }],
    ["古い版の失敗", { runs: [run("failure", P), run("failure", P), run("success", X)], tip: tip(), revertedToday: false }],
    ["マージではない", { runs: ok, tip: tip({ parents: [P], message: "直接のコミット" }), revertedToday: false }],
    ["前の結果がない", { runs: ok.slice(0, 2), tip: tip(), revertedToday: false }],
    ["1日に2回目", { runs: ok, tip: tip(), revertedToday: true }],
  ] as [string, Parameters<typeof decideRevert>[0]][]) {
    assert.equal(decideRevert(x).action, "human", why);
  }
});

test("自動の戻し: 戻したあとも失敗が続くなら、それ以上は戻さず、1回だけ人に回す", () => {
  const R = "r".repeat(40);
  const reverted = tip({ sha: R, parents: [T, "y".repeat(40)], message: "Merge pull request #171 from shohei9278/auto-revert/tttttttttttt\n\n自動の戻し" });
  assert.equal(decideRevert({ runs: [run("failure", R), run("failure", R), run("failure", T)], tip: reverted, revertedToday: true }).action, "human");
  assert.equal(decideRevert({ runs: [run("failure", R), run("failure", R), run("failure", R)], tip: reverted, revertedToday: true }).action, "none");
});

test("自動の戻し: 戻しの仕組み自体は、自動マージで触れない所", () => {
  assert.deepEqual(protectedFiles(["scripts/auto-revert.ts", "scripts/auto-revert-rules.ts", ".github/workflows/auto-revert.yml"]), ["scripts/auto-revert.ts", "scripts/auto-revert-rules.ts", ".github/workflows/auto-revert.yml"]);
});

test("自動の戻し: main の本番の確認だけを読み、3回前が別の版の失敗なら、そこを最初の判断の機会にする", () => {
  const runs = mainSmokeRuns([
    { conclusion: "failure", head_sha: T, head_branch: "main", event: "schedule" },
    { conclusion: "failure", head_sha: "o".repeat(40), head_branch: "feat/x", event: "workflow_dispatch" },
    { conclusion: "cancelled", head_sha: T, head_branch: "main", event: "schedule" },
    { conclusion: "failure", head_sha: T, head_branch: null, event: "deployment_status" },
    { conclusion: "success", head_sha: P, head_branch: "main", event: "schedule" },
  ]);
  assert.deepEqual(runs.map((x) => x.head_sha), [T, T, P]);
  // 3回前が別の版（P）の失敗: 2回目の判断の機会なので、何もしないではなく、直前の成功がないとして人に回す
  assert.equal(decideRevert({ runs: [run("failure", T), run("failure", T), run("failure", P)], tip: tip(), revertedToday: false }).action, "human");
});
