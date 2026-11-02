import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { wrapToolHtml } from "../../lp-site/src/lp/toolHtml";
import { dataDir } from "./db";

// 動くツールを、公開する前に本物のブラウザ（スマホの画面幅）で動かして確かめる
// - 開いたとき・操作したときにエラーが出ないか
// - ボタンなどを押すと画面が変わるか（結果が出るか）
// - スマホ幅で横にはみ出していないか
// ブラウザが無い環境（サーバーなど）では、テストを飛ばして理由を返す

export type ToolTest = {
  ok: boolean;
  skipped?: string;
  errors: string[];
  clicked: number;
  changed: boolean;
  overflow: boolean;
  screenshot?: string; // dataDir("screenshots") の中のファイル名
  at: string;
};

async function launch(): Promise<Browser | string> {
  const tries = [
    () => chromium.launch({ channel: "chrome", headless: true }),
    ...(process.env.CHROMIUM_PATH ? [() => chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true })] : []),
    () => chromium.launch({ headless: true }),
  ];
  for (const t of tries) {
    try {
      return await t();
    } catch {}
  }
  return "テスト用のブラウザ（Chrome）が見つからないため、自動テストを飛ばしました";
}

export async function testTool(html: string, name: string): Promise<ToolTest> {
  const at = new Date().toISOString();
  const browser = await launch();
  if (typeof browser === "string") return { ok: true, skipped: browser, errors: [], clicked: 0, changed: false, overflow: false, at };
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`エラー: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`コンソール: ${m.text()}`); });
    await page.setContent(wrapToolHtml(html), { waitUntil: "load", timeout: 10_000 });
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => document.body.innerText);

    // 空の入力欄に、それらしい値を入れる
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll("input"))) {
        if (el.value) continue;
        const v = { number: "30", date: "2000-01-01", range: "", text: "テスト", search: "テスト", "": "テスト" }[el.type as "number"];
        if (v) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
      }
      for (const s of Array.from(document.querySelectorAll("select"))) {
        if (s.options.length > 1 && s.selectedIndex <= 0) { s.selectedIndex = 1; s.dispatchEvent(new Event("change", { bubbles: true })); }
      }
    });
    // 押せるものを順に押す（多すぎるときは最初の20個）
    const targets = page.locator("button, [role=button], input[type=checkbox], input[type=radio], a[href^='#']");
    const n = Math.min(await targets.count(), 20);
    let clicked = 0;
    for (let i = 0; i < n; i++) {
      const t = targets.nth(i);
      try {
        if (!(await t.isVisible())) continue;
        await t.click({ timeout: 1000 });
        clicked++;
        await page.waitForTimeout(150);
      } catch {}
    }
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.body.innerText);
    // スマホの表示では画面の幅が中身に合わせて広がることがあるので、決まった幅（375px）と比べる
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 377);

    const file = `${name.replace(/[^a-z0-9-]/gi, "_")}.png`;
    await page.screenshot({ path: path.join(dataDir("screenshots"), file), fullPage: true, timeout: 10_000 });
    const uniq = [...new Set(errors)].slice(0, 6).map((e) => e.slice(0, 300));
    const changed = before !== after;
    return { ok: uniq.length === 0 && changed && !overflow, errors: uniq, clicked, changed, overflow, screenshot: file, at };
  } catch (e) {
    return { ok: false, errors: [`テストの途中で失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`], clicked: 0, changed: false, overflow: false, at };
  } finally {
    await browser.close().catch(() => {});
  }
}

// AIに直させるときの指示文
export function testIssues(t: ToolTest): string[] {
  if (t.skipped) return [];
  return [
    ...t.errors.map((e) => `ブラウザで動かしたら出た${e}`),
    ...(t.clicked > 0 && !t.changed ? ["ボタンなどを押しても画面が何も変わらない（結果が表示されない）"] : []),
    ...(t.clicked === 0 ? ["押せるボタンや入力欄が見つからない"] : []),
    ...(t.overflow ? ["スマホ幅（375px）で、横にはみ出している"] : []),
  ];
}

export function screenshotPath(file: string): string | null {
  if (!/^[a-z0-9_-]+\.png$/i.test(file)) return null;
  const p = path.join(dataDir("screenshots"), file);
  return fs.existsSync(p) ? p : null;
}
