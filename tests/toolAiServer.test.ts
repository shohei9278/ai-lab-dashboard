import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { answerToolAi, checkPassed, ModelCallError, parseToolAiRequest, type ModelCall, type ModelResult, type ToolAiDeps } from "../lp-site/src/lib/toolAiServer";
import { TOOL_AI_INPUT_MAX, TOOL_AI_JPY_PER_USD, TOOL_AI_LIVE, maxCostJpy, tokensCostJpy, toolAiAnswerOf } from "../lp-site/src/lp/toolAi";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";

// 公開サイトのサーバーで、その場で AI を呼ぶ（docs/design-tool-limits.md の ③）。AI と Supabase は差し替えて確かめる（お金はかからない）

const spec = { instruction: "名前に、やさしいあだ名を1つ付ける", inputMax: 20, outputMax: 40 };
const body = { slug: "p90", version: 3, visitorId: "0b6f1c2e-1111-4a5b-9c3d-123456789abc", input: "たろう" };

function fakeDeps(o: { spec?: typeof spec | null; reserve?: number | null; results?: (ModelResult | Error)[]; live?: boolean; ipHash?: string | null } = {}) {
  const calls: ModelCall[] = [];
  const reserved: number[] = [];
  const ips: string[] = [];
  const settled: [number, number | null][] = [];
  const logs: string[] = [];
  const results = [...(o.results ?? [{ text: "たろちゃん", inputTokens: 300, outputTokens: 10, refused: false }, { text: "OK", inputTokens: 200, outputTokens: 1, refused: false }])];
  const deps: ToolAiDeps = {
    live: o.live ?? true,
    ipHash: o.ipHash === undefined ? "abc" : o.ipHash,
    spec: async (slug, version) => (slug === body.slug && version === body.version ? (o.spec === undefined ? spec : o.spec) : null),
    reserve: async (r) => { reserved.push(r.amountJpy); ips.push(r.ipHash); return o.reserve === undefined ? 7 : o.reserve; },
    settle: async (id, jpy) => { settled.push([id, jpy]); },
    call: async (c) => {
      calls.push(c);
      const r = results.shift();
      if (!r) throw new Error("呼びすぎ");
      if (r instanceof Error) throw r;
      return r;
    },
    log: (m) => logs.push(m),
  };
  return { deps, calls, reserved, settled, logs, ips };
}

test("費用: 1回にかかりうる最大の額は、固定の指示と入力・答えの上限から出し、実際の額より大きい", () => {
  const max = maxCostJpy(spec, 3);
  assert.ok(max > tokensCostJpy(300 + 200, 10 + 1));
  // 指示が長いほど、入力が長いほど、多く取っておく
  assert.ok(maxCostJpy({ ...spec, instruction: "x".repeat(2000) }, 3) > max);
  assert.ok(maxCostJpy(spec, 20) > max);
  // 換算は試算（1ドル150円）より高め
  assert.ok(TOOL_AI_JPY_PER_USD > 150);
});

test("頼みの形: 名前・版・訪問者の番号・入力の形が違えば invalid", async () => {
  assert.ok(parseToolAiRequest(body));
  for (const bad of [null, "x", { ...body, slug: "../x" }, { ...body, version: "3" }, { ...body, version: 1.5 }, { ...body, visitorId: "a b" }, { ...body, visitorId: "x".repeat(65) }, { ...body, input: 3 }]) {
    const f = fakeDeps();
    assert.deepEqual(await answerToolAi(bad, f.deps), { ok: false, reason: "invalid" }, JSON.stringify(bad));
    assert.equal(f.reserved.length, 0);
  }
});

test("確かめ: 公開中の今の版で、人が承認した指示がなければ unavailable。入力が空・長すぎるなら invalid。どちらも額は取らない", async () => {
  for (const [b, o, reason] of [
    [{ ...body, version: 2 }, {}, "unavailable"],
    [body, { spec: null }, "unavailable"],
    [{ ...body, input: "  " }, {}, "invalid"],
    [{ ...body, input: "あ".repeat(21) }, {}, "invalid"],
  ] as const) {
    const f = fakeDeps(o);
    assert.deepEqual(await answerToolAi(b, f.deps), { ok: false, reason });
    assert.equal(f.reserved.length, 0);
    assert.equal(f.calls.length, 0);
  }
});

test("上限: 額を取れなければ（止めている・1日や月の上限・1ブラウザの回数）、AI を呼ばずに limit", async () => {
  const f = fakeDeps({ reserve: null });
  assert.deepEqual(await answerToolAi(body, f.deps), { ok: false, reason: "limit" });
  assert.equal(f.calls.length, 0);
  assert.equal(f.settled.length, 0);
});

test("答える: 答えてから見せてよいかを確かめ、実際の額で精算する。答えは上限の長さで切る", async () => {
  const f = fakeDeps({ results: [{ text: `  ${"あ".repeat(50)}\n`, inputTokens: 300, outputTokens: 60, refused: false }, { text: "OK", inputTokens: 200, outputTokens: 1, refused: false }] });
  assert.deepEqual(await answerToolAi(body, f.deps), { ok: true, text: "あ".repeat(40) });
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].system.includes(spec.instruction));
  assert.equal(f.calls[0].user, "たろう");
  // 確かめる呼び出しには、見せる文だけを渡す（訪問者の入力は渡さない）
  assert.equal(f.calls[1].user, "あ".repeat(40));
  assert.deepEqual(f.settled, [[7, tokensCostJpy(300, 60) + tokensCostJpy(200, 1)]]);
  // 精算した額は、取っておいた額を超えない
  assert.ok(f.settled[0][1]! <= f.reserved[0]);
});

test("答える: 見せてよくない・AI が断った・答えが空なら failed（精算はする）", async () => {
  for (const results of [
    [{ text: "x", inputTokens: 1, outputTokens: 1, refused: false }, { text: "NG", inputTokens: 1, outputTokens: 1, refused: false }],
    [{ text: "", inputTokens: 1, outputTokens: 0, refused: true }],
    [{ text: "  ", inputTokens: 1, outputTokens: 1, refused: false }],
    [{ text: "x", inputTokens: 1, outputTokens: 1, refused: false }, { text: "", inputTokens: 1, outputTokens: 0, refused: true }],
    [{ text: "x", inputTokens: 1, outputTokens: 1, refused: false }, { text: "OK ですが、念のため", inputTokens: 1, outputTokens: 3, refused: false }],
    [{ text: "x", inputTokens: 1, outputTokens: 1, refused: false }, { text: "ok", inputTokens: 1, outputTokens: 1, refused: false }],
  ]) {
    const f = fakeDeps({ results });
    assert.deepEqual(await answerToolAi(body, f.deps), { ok: false, reason: "failed" });
    assert.equal(f.settled.length, 1);
    assert.equal(typeof f.settled[0][1], "number");
  }
});

test("失敗: お金がかかったか分からないときは、取っておいた額のまま残す（null で精算）。かかっていないと分かれば、それまでの額で精算する", async () => {
  const unknown = fakeDeps({ results: [new ModelCallError("unknown")] });
  assert.deepEqual(await answerToolAi(body, unknown.deps), { ok: false, reason: "failed" });
  assert.deepEqual(unknown.settled, [[7, null]]);
  // 答えたあと、確かめる呼び出しが時間切れ
  const late = fakeDeps({ results: [{ text: "x", inputTokens: 300, outputTokens: 5, refused: false }, new Error("timeout")] });
  assert.deepEqual(await answerToolAi(body, late.deps), { ok: false, reason: "failed" });
  assert.deepEqual(late.settled, [[7, null]]);
  const notBilled = fakeDeps({ results: [new ModelCallError("not-billed")] });
  assert.deepEqual(await answerToolAi(body, notBilled.deps), { ok: false, reason: "failed" });
  assert.deepEqual(notBilled.settled, [[7, 0]]);
  // ログには種類だけを出す（入力も答えも出さない）
  for (const m of [...unknown.logs, ...late.logs, ...notBilled.logs]) assert.ok(!m.includes("たろう"));
});

test("枠の中の窓口: window.labAi.ask がページとやりとりして答えを受け取る。ページが答えない・おかしな答えなら failed・unavailable", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  try {
    const page = await browser.newPage();
    const tool = `<script>
      window.run = async function () {
        var a = await window.labAi.ask("たろう");
        var b = await window.labAi.ask("x");
        var c = await window.labAi.ask(3);
        var d = await window.labAi.ask("${"x".repeat(TOOL_AI_INPUT_MAX + 1)}");
        var e = await window.labAi.ask("ok-missing");
        parent.postMessage({ result: { a: a, b: b, c: c, d: d, e: e } }, "*");
      };
    </script>`;
    // ページの側（ToolFrame と同じ答え方を、テストの中で再現する）
    await page.setContent(`<iframe id="f" sandbox="allow-scripts"></iframe><script>
      addEventListener("message", function (e) {
        var d = e.data, f = document.getElementById("f").contentWindow;
        if (e.source !== f || !d) return;
        if (d.result) { window.__result = d.result; return; }
        if (d.__lab === "ai-ask") f.postMessage(d.input === "たろう" ? { __lab: "ai-answer", id: d.id, ok: true, text: "たろちゃん" } : d.input === "ok-missing" ? { __lab: "ai-answer", id: d.id, reason: "limit" } : { __lab: "ai-answer", id: d.id, ok: false, reason: "へんな理由" }, "*");
      });
    </script>`);
    await page.locator("#f").evaluate((el, h) => { (el as HTMLIFrameElement).srcdoc = h; }, wrapToolHtml(tool));
    await page.waitForTimeout(300);
    await page.frames()[1].evaluate("window.run()");
    await page.waitForFunction("!!window.__result", null, { timeout: 5000 });
    assert.deepEqual(await page.evaluate("window.__result"), { a: { ok: true, text: "たろちゃん" }, b: { ok: false, reason: "failed" }, c: { ok: false, reason: "invalid" }, d: { ok: false, reason: "invalid" }, e: { ok: false, reason: "failed" } });
  } finally {
    await browser.close();
  }
});

test("使えるようにするまでは: どんな頼みにも unavailable と答え、額も取らず AI も呼ばない（PR #241 の ai-review の指摘）", async () => {
  assert.equal(TOOL_AI_LIVE, false);
  const f = fakeDeps({ live: false });
  assert.deepEqual(await answerToolAi(body, f.deps), { ok: false, reason: "unavailable" });
  assert.equal(f.reserved.length, 0);
  assert.equal(f.calls.length, 0);
});

test("接続元: 印を額の先取りに渡す。分からなければ、みんなで1つの枠（unknown）を使う", async () => {
  const f = fakeDeps({ ipHash: "h1" });
  await answerToolAi(body, f.deps);
  const g = fakeDeps({ ipHash: null });
  await answerToolAi(body, g.deps);
  assert.deepEqual([...f.ips, ...g.ips], ["h1", "unknown"]);
});

test("入力の長さ: 共通の上限を超える入力は、空白を除いて短くなっても invalid（切って送らない）", async () => {
  const f = fakeDeps({ spec: { ...spec, inputMax: TOOL_AI_INPUT_MAX } });
  assert.deepEqual(await answerToolAi({ ...body, input: `たろう${" ".repeat(TOOL_AI_INPUT_MAX)}` }, f.deps), { ok: false, reason: "invalid" });
  assert.equal(f.reserved.length, 0);
});

test("確かめの答え: 前後の空白を除いて OK とぴったり同じときだけ通す", () => {
  assert.equal(checkPassed("OK"), true);
  assert.equal(checkPassed(" OK\n"), true);
  for (const t of ["ok", "OK。", "OK ですが", "NG", "", "OKOK"]) assert.equal(checkPassed(t), false, t);
});

test("答えの形: 成功は ok が true で text が文字列、失敗は ok が false で決まった理由のときだけ。ほかは failed（PR #241 の ai-review の指摘）", () => {
  assert.deepEqual(toolAiAnswerOf({ ok: true, text: "x" }), { ok: true, text: "x" });
  assert.deepEqual(toolAiAnswerOf({ ok: false, reason: "limit" }), { ok: false, reason: "limit" });
  for (const bad of [null, "x", { ok: true }, { reason: "limit" }, { ok: "false", reason: "limit" }, { ok: false, reason: "へんな理由" }, { ok: true, text: 3, reason: "limit" }]) {
    assert.deepEqual(toolAiAnswerOf(bad), { ok: false, reason: "failed" }, JSON.stringify(bad));
  }
});
