import assert from "node:assert/strict";
import { test } from "node:test";
import { afterDeliberation, FIX_TEXT_MAX, HISTORY_MAX_COMMENTS, HUMAN_MARK, afterReview, beforeReview, changedPaths, fireRejected, fixMarker, fixRequested, fixRounds, fixText, handedToHuman, MAX_REVIEW_FAILS, promptChanged, TOKEN_WARN_DAYS, tokenDaysLeft, protectedFiles, readyForHuman, smokeResult, reviewFailMarker, reviewFailures, reviewHistory, reviewMarker, type PrComment } from "../scripts/auto-merge-rules";
import { deliberationComment, fitDiff, MAX_BODY, MAX_DIFF, parseDeliberation, parseReview, reviewInput, reviewInstructions, type Review } from "../scripts/ai-review-core";
import { OMITTED } from "../scripts/ai-review-omitted";

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

test("自動マージ: 自動で触れない所はレビューまで進め、CI の失敗・全部を読めないとき・レビューの答えを読めないとき・途中までのときは人に回す", () => {
  // 自動で触れない所に触れていても、レビューまでは進める（マージだけ人が決める。readyForHuman）
  assert.deepEqual(pre({ files: ["src/lib/loop.ts", ".github/workflows/ci.yml"] }).protectedFiles, [".github/workflows/ci.yml"]);
  for (const f of ["src/proxy.ts", "src/lib/ai.ts", "src/lib/autopilot.ts", "src/lib/autoAsk.ts", "scripts/auto-merge-rules.ts", "scripts/ai-review-core.ts", "src/lib/interventions.ts", "src/data/interventions/x.json", "package.json", "docs/routine-proposal-fix.md", "CLAUDE.md", "src/app/login/LoginForm.tsx", "src/app/settings/SettingsForm.tsx", "src/app/api/settings/route.ts"]) {
    assert.deepEqual([pre({ files: [f] }).action, pre({ files: [f] }).protectedFiles], ["review", [f]], f);
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
  assert.deepEqual(pre({ files: paths }).protectedFiles, ["src/lib/ai.ts"]);
});

test("レビューの答え: 中身が欠けている・重さが分からない・オブジェクトでない指摘は、重さに関係なく 🔴 として数える", () => {
  const r = parseReview("gpt", JSON.stringify({ summary: "s", findings: [{ severity: "low" }, "文字だけ", { file: "a.ts", issue: "x", why: "y", severity: "critical" }, { file: "b.ts", issue: "x", why: "y", severity: "low" }] }), false);
  assert.deepEqual(r.findings.map((f) => f.severity), ["high", "high", "high", "low"]);
  // 「最大8件」より多く返ってきても、件数で切らない（9件目の 🔴 を捨てない）
  const many = parseReview("gpt", JSON.stringify({ summary: "s", findings: [...Array.from({ length: 8 }, () => ({ file: "a.ts", issue: "x", why: "y", severity: "low" })), { file: "a.ts", issue: "x", why: "y", severity: "high" }] }), false);
  assert.equal(many.findings.length, 9);
  assert.equal(many.findings[8].severity, "high");
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
  // 本物は、最初と3回直したあとのレビューで 2社×4回=8件まで。8件は渡せる
  assert.equal(HISTORY_MAX_COMMENTS, 8);
  assert.equal(reviewHistory(Array.from({ length: 8 }, (_, i) => bot(reviewMarker("gpt", `s${i}`)))).ok, true);
  assert.equal(reviewHistory(Array.from({ length: HISTORY_MAX_COMMENTS + 1 }, (_, i) => bot(reviewMarker("gpt", `s${i}`)))).ok, false);
  // 同じ AI と版のレビューは、何度書いても1組と数える。形の読めない印は1件ずつ数える
  const same = Array.from({ length: 12 }, () => bot(reviewMarker("gpt", "s1")));
  assert.equal(reviewHistory(same).ok, true);
  assert.equal(reviewHistory(Array.from({ length: HISTORY_MAX_COMMENTS + 1 }, () => bot("<!-- auto-merge review 形が違う"))).ok, false);
  assert.match(reviewInstructions({ autoPr: true, withHistory: false, recheck: true }), /直っているかを1件ずつ確かめ/);
  assert.doesNotMatch(reviewInstructions({ autoPr: true, withHistory: false }), /前の版へのレビュー/);
  // 予算の中なら費用が増えてもよいが、緊急停止と予算の上限を確かめずにAIを呼ぶ変更は 🔴（運営者が決めた）
  assert.match(reviewInstructions({ autoPr: true, withHistory: false }), /予算の上限を確かめずにAIを呼ぶ変更.*high にする/);
  assert.doesNotMatch(reviewInstructions({ autoPr: false, withHistory: false }), /予算の上限を確かめずに/);
});

test("自動マージ: ルーティンの起動ではっきり断られたのは 4xx だけ（408・429・5xx は届いたか分からないので、直しの印を残す）", () => {
  for (const s of [400, 401, 403, 404, 422]) assert.equal(fireRejected(s), true, String(s));
  for (const s of [408, 429, 500, 502, 503]) assert.equal(fireRejected(s), false, String(s));
});

test("自動マージ: レビューを頼めなかった回数は、この版のボットの印だけを数える（3回で人に回す）", () => {
  assert.equal(MAX_REVIEW_FAILS, 3);
  const c = [bot(reviewFailMarker(SHA)), bot(reviewFailMarker(SHA)), bot(reviewFailMarker("old")), { body: reviewFailMarker(SHA), user: { login: "someone" } }];
  assert.equal(reviewFailures(c, SHA), 2);
  assert.equal(reviewFailures(c, "new"), 0);
});

test("自動マージ: 本番の確認は、いちばん新しい回だけで決める。動いている途中・取り消し・飛ばしのときは待つ", () => {
  const done = (conclusion: string) => ({ status: "completed", conclusion });
  assert.equal(smokeResult([done("success"), done("failure")]), true);
  assert.equal(smokeResult([done("failure"), done("success")]), false);
  assert.equal(smokeResult([{ status: "in_progress", conclusion: null }, done("success")]), null);
  assert.equal(smokeResult([{ status: "queued", conclusion: null }, done("success")]), null);
  assert.equal(smokeResult([done("cancelled"), done("success")]), null);
  assert.equal(smokeResult([done("skipped"), done("success")]), null);
  assert.equal(smokeResult([done("timed_out"), done("success")]), false);
  assert.equal(smokeResult([done("cancelled")]), null);
  assert.equal(smokeResult([]), null);
});

test("自動マージ: レビューの差分から外すファイルは、すべて自動で触れない所に入っている（外したファイルの中身を見ないままマージしない）", () => {
  assert.deepEqual(protectedFiles(OMITTED), OMITTED);
});

test("レビューの材料: PR の説明文が長すぎるときは、黙って切らずに途中まで（cut）とする", () => {
  assert.equal(reviewInput({ prBody: "要件".repeat(100), diff: "d" }).cut, false);
  const long = reviewInput({ prBody: "あ".repeat(MAX_BODY + 1), diff: "d" });
  assert.equal(long.cut, true);
  assert.match(long.input, /（長いため途中まで）/);
});

test("協議: 3回直しても 🟡 だけが残れば協議に回し、🔴 が残れば人に回す", () => {
  const tried = [bot(fixMarker("a")), bot(fixMarker("b")), bot(fixMarker("c"))];
  assert.equal(afterReview({ gpt: rv("gpt", ["medium"]), gemini: rv("gemini", ["low"]) }, fixRounds(tried)).action, "deliberate");
  assert.equal(afterReview({ gpt: rv("gpt", ["medium"]), gemini: rv("gemini", ["high"]) }, fixRounds(tried)).action, "human");
  // 3回より前は、今までどおり直させる
  assert.equal(afterReview({ gpt: rv("gpt", ["medium"]), gemini: rv("gemini", []) }, 2).action, "fix");
});

test("協議: 2社とも全部を「マージしてよい」としたときだけマージ。1件でも「直すべき」・読めない答えは人に回す", () => {
  const ok = (n: number) => JSON.stringify({ verdicts: Array.from({ length: n }, (_, i) => ({ id: i + 1, decision: "merge_ok", reason: "端の場合" })) });
  const both = (g: string, m: string, n: number) => ({ gpt: parseDeliberation("gpt", g, n), gemini: parseDeliberation("gemini", m, n) });
  assert.equal(afterDeliberation(2, both(ok(2), ok(2), 2)).action, "merge");
  const one = JSON.stringify({ verdicts: [{ id: 1, decision: "merge_ok", reason: "r" }, { id: 2, decision: "must_fix", reason: "壊れる" }] });
  assert.match(afterDeliberation(2, both(ok(2), one, 2)).reason, /1件が「直すべき」/);
  assert.equal(afterDeliberation(2, { gpt: parseDeliberation("gpt", ok(2), 2) }).action, "human");
  // 欠け・重なり・知らない答え・理由なしは、読めない
  for (const bad of [ok(1), JSON.stringify({ verdicts: [{ id: 1, decision: "merge_ok", reason: "r" }, { id: 1, decision: "merge_ok", reason: "r" }] }),
    JSON.stringify({ verdicts: [{ id: 1, decision: "ok", reason: "r" }, { id: 2, decision: "merge_ok", reason: "r" }] }),
    JSON.stringify({ verdicts: [{ id: 1, decision: "merge_ok", reason: "" }, { id: 2, decision: "merge_ok", reason: "r" }] }), "読めない"]) {
    assert.equal(parseDeliberation("gpt", bad, 2).parsed, false, bad);
    assert.equal(afterDeliberation(2, both(bad, ok(2), 2)).action, "human", bad);
  }
  // 結果は PR に、指摘ごとに2社の判断を書く
  const f = rv("gpt", ["medium", "medium"]).findings;
  const c = deliberationComment(f, both(ok(2), one, 2));
  assert.match(c, /✅ マージしてよい/);
  assert.match(c, /🛑 直すべき（壊れる）/);
});

test("自動で触れない所: レビュー・直し・協議までは進め、マージしてよい状態になったら、レビュー済みとして人に回す", () => {
  assert.equal(pre().protectedFiles, undefined);
  const p = pre({ files: ["src/app/settings/SettingsForm.tsx", "src/lib/loop.ts"] });
  assert.deepEqual([p.action, p.protectedFiles], ["review", ["src/app/settings/SettingsForm.tsx"]]);
  // CI が落ちている・本番の確認が分からないなどは、今までどおり
  assert.equal(pre({ files: ["src/proxy.ts"], ciOk: false }).action, "human");
  assert.equal(pre({ files: ["src/proxy.ts"], smokeOk: null }).action, "wait");
  const d = afterReview({ gpt: rv("gpt", []), gemini: rv("gemini", ["low"]) }, 0);
  assert.equal(d.action, "merge");
  const h = readyForHuman(d, p.protectedFiles!);
  assert.equal(h.action, "human");
  assert.match(h.reason, /^✅ レビュー済みで、マージしてよい状態（CI が通り、GPT と Gemini のどちらも直すべき指摘なし）。ただし、自動ではマージしない所（src\/app\/settings\/SettingsForm\.tsx）に触れている$/);
});

test("AIへの指示の変更: 2社とも「変えていない」と答えたときだけ、変えていないとする（答えがないときは変えているとする）", () => {
  const r = (pc: unknown) => parseReview("gpt", JSON.stringify({ summary: "s", prompt_changed: pc, findings: [] }), false);
  assert.equal(r(true).promptChanged, true);
  assert.equal(r(false).promptChanged, false);
  assert.equal(r("no").promptChanged, null);
  // 答えを読めなかったときも null（安全側では「変えている」とみなす）
  assert.equal(parseReview("gpt", "読めない", false).promptChanged, null);
  assert.equal(parseReview("gpt", JSON.stringify({ summary: "s" }), false).promptChanged, null);
  const g = (pc: unknown) => ({ ...r(pc), reviewer: "gemini" as const });
  assert.equal(promptChanged({ gpt: r(false), gemini: g(false) }), false);
  assert.equal(promptChanged({ gpt: r(false), gemini: g(true) }), true);
  assert.equal(promptChanged({ gpt: r(false), gemini: g(undefined) }), true);
  // マージしてよい状態でも、指示を変えていればレビュー済みとして人に回す
  const d = afterReview({ gpt: r(true), gemini: g(false) }, 0);
  assert.equal(d.action, "merge");
  assert.match(readyForHuman(d, [], true).reason, /ただし、AIへの指示（プロンプト）を変えている$/);
  assert.match(readyForHuman(d, ["src/proxy.ts"], true).reason, /ただし、自動ではマージしない所（src\/proxy\.ts）に触れている・AIへの指示（プロンプト）を変えている$/);
  // 自動マージのレビューにだけ、答えの形に prompt_changed を入れる
  assert.match(reviewInstructions({ autoPr: true, withHistory: false }), /"prompt_changed"/);
  assert.doesNotMatch(reviewInstructions({ autoPr: false, withHistory: false }), /prompt_changed/);
});

test("トークンの期限: GitHub の答えの期限の日付から、残りの日数を出す（期限なし・読めない形は null）", () => {
  const now = new Date("2026-11-23T00:15:00Z");
  assert.equal(tokenDaysLeft("2026-12-01 00:00:00 UTC", now), 7);
  assert.equal(tokenDaysLeft("2027-11-23 00:00:00 UTC", now), 364);
  assert.equal(tokenDaysLeft("2026-11-20 00:00:00 UTC", now)! < 0, true);
  assert.equal(tokenDaysLeft(null, now), null);
  assert.equal(tokenDaysLeft("いつか", now), null);
  assert.equal(TOKEN_WARN_DAYS, 14);
});

test("レビューに渡す差分: 上限を超えたら、先にテストの差分を外して本体を全部見せる。外したファイルは名前を伝える。それでも超えたら途中まで", () => {
  const file = (path: string, size: number) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n+${"x".repeat(size)}\n`;
  const small = file("src/lib/a.ts", 100) + file("tests/a.test.ts", 100);
  assert.deepEqual(fitDiff(small), { diff: small, droppedTests: [] }, "上限より短ければそのまま");
  const big = file("src/lib/a.ts", MAX_DIFF - 1000) + file("tests/a.test.ts", 5000) + file("e2e/b.spec.ts", 5000) + file("src/lib/b.ts", 100);
  const fit = fitDiff(big);
  assert.deepEqual(fit.droppedTests, ["tests/a.test.ts", "e2e/b.spec.ts"]);
  assert.match(fit.diff, /src\/lib\/a\.ts[^]*src\/lib\/b\.ts/);
  assert.doesNotMatch(fit.diff, /tests\/a\.test\.ts/);
  const r = reviewInput({ diff: big });
  assert.equal(r.cut, false, "テストを外して収まれば、途中までにはしない");
  assert.match(r.input, /テストのファイルの差分は渡していない[^]*tests\/a\.test\.ts、e2e\/b\.spec\.ts/);
  // テストのファイルを本体へ移した差分は、本体のコードなので外さない（PR #178 の ai-review の指摘）
  const moved = `diff --git a/tests/foo.ts b/src/lib/foo.ts\nrename from tests/foo.ts\nrename to src/lib/foo.ts\n+${"y".repeat(100)}\n`;
  const withMove = fitDiff(big + moved);
  assert.deepEqual(withMove.droppedTests, ["tests/a.test.ts", "e2e/b.spec.ts"]);
  assert.match(withMove.diff, /b\/src\/lib\/foo\.ts/);
  const huge = reviewInput({ diff: file("src/lib/a.ts", MAX_DIFF + 10) });
  assert.equal(huge.cut, true);
  assert.match(huge.input, /（長いため途中まで）$/);
});
