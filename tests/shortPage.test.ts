import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { FIT_SCREEN_RULE, MOTION_RULE, SHORT_PAGE_AIMS, devRequestText, shortToolPage } from "../src/lib/loop";
import { db } from "../src/lib/db";
import { normalizeLp } from "../lp-site/src/lp/content";
import { pickOthers } from "../lp-site/src/lp/categories";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";

const base = { headline: "h", subheadline: "s", cta: "c", pains: [], features: [], faq: [] };

test("ツールの短いページ（運営者の依頼）: 広がる・また来てもらうのツールは紹介ページを作らない。役に立つ・需要を確かめるは今までどおり", () => {
  assert.deepEqual(SHORT_PAGE_AIMS, ["spread", "return"]);
  assert.equal(shortToolPage("spread"), true);
  assert.equal(shortToolPage("return"), true);
  assert.equal(shortToolPage("useful"), false);
  assert.equal(shortToolPage("demand"), false);
  // ねらいのない前からある案件は、今までどおり
  assert.equal(shortToolPage(null), false);
});

test("ツールの短いページ: 印（short）は、ツールのある中身でだけ残す", () => {
  const tool = { html: "<button>押す</button><script>1</script>", shareText: "s" };
  assert.equal(normalizeLp({ ...base, tool, short: true }).short, true);
  // ツールのない事前登録のページや、印が true でないものには付けない
  assert.equal(normalizeLp({ ...base, short: true }).short, undefined);
  assert.equal(normalizeLp({ ...base, tool, short: "yes" }).short, undefined);
  assert.equal(normalizeLp({ ...base, tool }).short, undefined);
});

test("遊びのツールの全画面（運営者の依頼）: 枠を画面の高さに決めるときだけ、枠の中で引っぱっても外のページが動かないようにする", () => {
  assert.match(wrapToolHtml("<p>x</p>", { fill: true }), /html,body\{overscroll-behavior:none\}/);
  assert.doesNotMatch(wrapToolHtml("<p>x</p>"), /overscroll-behavior/);
  // 遊ぶ画面では、canvas の上でなぞっても枠の中がスクロールしない（提案箱 #113）。ツールの指定を上書きしないよう、無名の @layer に入れる
  assert.match(wrapToolHtml("<p>x</p>", { fill: true }), /@layer\{html,body\{margin:0\}canvas\{touch-action:none\}\}/);
  assert.doesNotMatch(wrapToolHtml("<p>x</p>"), /touch-action/);
});

test("遊ぶ画面の canvas の touch-action（提案箱 #113・PR #215 のレビューの指摘）: 枠の既定は none。ツールが決めたときは、@layer の中でも外でもツールの指定を使う（ブラウザがあるときだけ）", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  try {
    const page = await browser.newPage();
    const cases: [string, string][] = [
      ["<canvas id=c></canvas>", "none"],
      ["<style>@layer tool{canvas{touch-action:pan-y}}</style><canvas id=c></canvas>", "pan-y"],
      ["<style>canvas{touch-action:pan-x}</style><canvas id=c></canvas>", "pan-x"],
      ['<canvas id=c style="touch-action:manipulation"></canvas>', "manipulation"],
    ];
    for (const [html, want] of cases) {
      await page.setContent(wrapToolHtml(html, { fill: true }));
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("c")!).touchAction), want, html);
    }
    // 枠を画面の高さに決めないときは、枠の側では付けない
    await page.setContent(wrapToolHtml("<canvas id=c></canvas>"));
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("c")!).touchAction), "auto");
  } finally {
    await browser.close();
  }
});

test("遊ぶ画面の body の余白（#73。運営者が原因を見つけた）: 枠の既定は 0 で、画面の高さにしたツールが枠からはみ出さない。ツールが余白を決めたときは、そちらを使う（ブラウザがあるときだけ）", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 640 } });
    // #73 と同じ形: いちばん外の箱を画面の高さにし、その箱の余白だけを 0 にする（body の余白は決めない）
    const tool = "<style>#mi{box-sizing:border-box;height:100vh;height:100dvh;margin:0;padding:10px}</style><div id=mi>x</div>";
    const size = async () => (await page.evaluate("[document.scrollingElement.scrollHeight, innerHeight, getComputedStyle(document.body).marginTop]")) as [number, number, string];
    await page.setContent(wrapToolHtml(tool, { fill: true }));
    const [scroll, inner, margin] = await size();
    assert.equal(margin, "0px");
    assert.equal(scroll, inner);
    // 枠を画面の高さに決めないときは、枠の側では変えない（ブラウザの初めの余白のまま）
    await page.setContent(wrapToolHtml(tool));
    assert.equal((await size())[2], "8px");
    // ツールが自分で余白を決めたときは、@layer の中でも外でも、そちらを使う
    for (const [css, want] of [["@layer tool{body{margin:4px}}", "4px"], ["body{margin:6px}", "6px"]] as const) {
      await page.setContent(wrapToolHtml(`<style>${css}</style><p>x</p>`, { fill: true }));
      assert.equal((await size())[2], want, css);
    }
  } finally {
    await browser.close();
  }
});

test("遊びのツールの結果のあとの「ほかの遊び」: 同じカテゴリを先に、足りなければほかのツールで埋める。自分は出さない", () => {
  const t = (slug: string, category: string | null) => ({ slug, category });
  const list = [t("a", "quiz"), t("me", "game"), t("b", "game"), t("c", null), t("d", "game"), t("e", "calc")];
  assert.deepEqual(pickOthers(list, "me").map((x) => x.slug), ["b", "d", "a"]);
  assert.deepEqual(pickOthers(list, "me", 5).map((x) => x.slug), ["b", "d", "a", "c", "e"]);
  // カテゴリがないツール・一覧にないツールは、一覧の順のまま
  assert.deepEqual(pickOthers(list, "c").map((x) => x.slug), ["a", "me", "b"]);
  assert.deepEqual(pickOthers(list, "zz", 2).map((x) => x.slug), ["a", "me"]);
  assert.deepEqual(pickOthers([t("me", "game")], "me"), []);
});

test("遊びのツールを1画面に収める（#66 で運営者が見つけた）: 短いページで出すツールの作る決まりにだけ、画面の高さに収める決まりを足す", () => {
  const add = (aim: string | null) => Number(db().prepare(
    "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim) VALUES ('t', 't', 'p', 's', 'h', 'r', 'lp', 'claude', 'tool', ?)",
  ).run(aim).lastInsertRowid);
  assert.match(FIT_SCREEN_RULE, /画面いっぱいの枠/);
  assert.match(FIT_SCREEN_RULE, /28pxの細い帯/); // 遊ぶ画面の上には細い帯だけがあり、その下が枠になる（運営者が決めた遊ぶ画面の作り）
  assert.match(FIT_SCREEN_RULE, /640px/);
  assert.match(FIT_SCREEN_RULE, /100dvh/);
  // 広がる・また来てもらうのツール（短いページ）には入れる
  assert.ok(devRequestText(add("spread"), "設計", null).includes(FIT_SCREEN_RULE));
  assert.ok(devRequestText(add("return"), "設計", null).includes(FIT_SCREEN_RULE));
  // 紹介ページのあるツール（枠がツールの高さに合わせて伸びる）には入れない
  assert.ok(!devRequestText(add("useful"), "設計", null).includes(FIT_SCREEN_RULE));
  assert.ok(!devRequestText(add(null), "設計", null).includes(FIT_SCREEN_RULE));
});

test("振りの強さの測り方（#72 で運営者が見つけた）: 作る決まりに、前の値との差ではなく重力をならした値からのずれで測ることを書き、どのツールにも渡す", () => {
  const add = (aim: string | null) => Number(db().prepare(
    "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim) VALUES ('t', 't', 'p', 's', 'h', 'r', 'lp', 'claude', 'tool', ?)",
  ).run(aim).lastInsertRowid);
  assert.match(MOTION_RULE, /window\.labMotion/);
  assert.match(MOTION_RULE, /1つ前に届いた値との差で測らない/);
  assert.match(MOTION_RULE, /ならす/);
  for (const aim of ["spread", "return", "useful", null]) { // 遊びの短いページ（spread・return）と、紹介ページのあるツール
    const text = devRequestText(add(aim), "設計", null);
    assert.ok(text.includes(MOTION_RULE));
    // 見つける・集めるツールで、見つけたものを二度目から「見つけた」と知らせない（#72 で運営者が決めた）
    assert.match(text, /「見つけた」の表示は初めてのときだけ/);
  }
});
