// 来訪者の主要な画面を本物のブラウザで確かめる（ページを移ったあとの表示など、1ページずつの確認では分からないもの）
// 事前に npm run build が必要。データは空の一時ファイルなので、本物には触らない
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright-core";

const PORT = 3459;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = "e2e-only";
const SECRET_ARTICLE = "E2Eの記事の本文";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lab-e2e-"));
process.env.AI_LAB_DB = path.join(dir, "e2e.db");
process.env.AI_LAB_SCHEDULER = "off";

let server: ChildProcess;
let browser: Browser;

async function seed() {
  const { db, saveSettings } = await import("../src/lib/db");
  saveSettings({ showcaseEnabled: true });
  const report = { summary: "E2Eのまとめ", numbers: [], highlights: [], noteIdeas: [], xPosts: ["E2Eの投稿の下書き"], next: [], article: SECRET_ARTICLE };
  db().prepare("INSERT INTO reports (period_start, period_end, model_id, content) VALUES ('2026-01-01', '2026-01-08', 'test', ?)").run(JSON.stringify(report));
}

before(async () => {
  await seed();
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, DASHBOARD_PASSWORD: PASSWORD, DASHBOARD_USER: "admin" },
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 60; i++) {
    const up = await fetch(`${BASE}/login`).then((r) => r.ok).catch(() => false);
    if (up) break;
    if (i === 59) throw new Error("サーバーが起動しませんでした");
    await new Promise((f) => setTimeout(f, 1000));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
});

after(async () => {
  await browser?.close();
  if (server?.pid) process.kill(-server.pid);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("概要ページとダッシュボードの行き来で、サイドバーが切り替わる", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const sidebar = page.locator("aside");
  // 再読み込みすると消える印。残っていれば、同じページのまま（クライアントで）移ったことになる
  const sameDocument = () => page.evaluate(() => (window as unknown as { __e2e?: boolean }).__e2e === true);
  await page.goto(`${BASE}/showcase`);
  assert.equal(await sidebar.count(), 0);
  await page.evaluate(() => { (window as unknown as { __e2e?: boolean }).__e2e = true; });
  await page.getByRole("link", { name: /実際のダッシュボードを見る/ }).click();
  await sidebar.waitFor();
  assert.ok(await sameDocument(), "ダッシュボードへの移動で再読み込みされました");
  await page.getByRole("link", { name: "はじめての方は概要ページへ" }).click();
  await page.waitForURL("**/showcase");
  await sidebar.waitFor({ state: "detached" });
  assert.ok(await sameDocument(), "概要ページへの移動で再読み込みされました");
  await page.goBack();
  await sidebar.waitFor();
  assert.ok(await sameDocument(), "戻るで再読み込みされました");
  await ctx.close();
});

test("来訪者: 主要なページがスマホ幅でエラーなく開き、横にはみ出さない", async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // コンソールのエラーも数える。来訪者の操作を断ったときの 403 だけは、想定どおりなので除く
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 403/.test(m.text())) errors.push(m.text());
  });
  const routes = ["/", "/showcase", "/projects", "/plan", "/live", "/approvals", "/proposals", "/meetings", "/diary", "/lab", "/lab/tests", "/growth", "/growth/stats", "/outside", "/interventions", "/notes", "/reports", "/settings", "/runs", "/runs/new", "/datasets"];
  for (const r of routes) {
    errors.length = 0;
    const res = await page.goto(BASE + r, { waitUntil: "load" });
    assert.equal(res?.status(), 200, `${r} が開けません`);
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({ text: document.body.innerText, width: document.documentElement.scrollWidth }));
    assert.ok(!state.text.includes("Application error"), `${r} が画面エラーになりました`);
    assert.ok(state.width <= 375, `${r} が横にはみ出しています（${state.width}px）`);
    assert.deepEqual(errors, [], `${r} でエラーが出ました`);
  }
  await ctx.close();
});

test("投稿前の下書きは、来訪者のHTMLに含まれず、運営者には出る", async () => {
  const guest = await fetch(`${BASE}/reports`).then((r) => r.text());
  assert.ok(guest.includes("E2Eのまとめ"));
  assert.ok(!guest.includes(SECRET_ARTICLE) && !guest.includes("E2Eの投稿の下書き"));
  const owner = await fetch(`${BASE}/reports`, { headers: { authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` } }).then((r) => r.text());
  assert.ok(owner.includes(SECRET_ARTICLE) && owner.includes("E2Eの投稿の下書き"));
});
