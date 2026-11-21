import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { wrapToolHtml } from "../../lp-site/src/lp/toolHtml";
import { PLAY_MIN_HEIGHT } from "../../lp-site/src/lp/inApp";
import type { ToolImages } from "../../lp-site/src/lp/content";
import { dataDir } from "./db";

// 動くツールを、公開する前に本物のブラウザ（スマホの画面幅）で動かして確かめる
// - 開いたとき・操作したときにエラーが出ないか
// - ボタンなどを押すと画面が変わるか（結果が出るか）
// - スマホ幅で横にはみ出していないか
// - 操作したときに「使った」の知らせ（公開サイトの計測のもと）が出るか。出ないと、公開しても利用が0人と数えられる
// - 振って遊ぶツール（window.labMotion を使う）は、振る動きを流すと、振らずに待ったときより画面が変わるか
//   （#72 で、強く振っても雪がほとんど舞わなかった。運営者が実機で見つけたものを、公開前に見つけられるように）
// - 遊びの短いページのツール（short）は、決まった高さ（640px）の画面で、押す所が画面の下に出ていないか
//   （X などのアプリの中で、いちばん下の操作が隠れた。運営者が見つけたものを、公開前に見つけられるように）
// ブラウザが無い環境（サーバーなど）では、テストを飛ばして理由を返す

export type ToolTest = {
  ok: boolean;
  skipped?: string;
  errors: string[];
  clicked: number;
  changed: boolean;
  overflow: boolean;
  used?: boolean; // 「使った」の知らせが出たか（この確かめを足す前のテストの結果には無い）
  motion?: { idle: number; shake: number; ok: boolean }; // 振って遊ぶツールで、振らずに待ったとき・振ったときに変わった画面の割合（0〜1）
  offscreen?: string[]; // 短いページのツールで、決まった高さの画面の下に出ていた押す所の名前
  screenshot?: string; // dataDir("screenshots") の中のファイル名
  at: string;
};

// 押す所（順に押す流れ・センサーまで進む流れ）と、画面の下に出ていないかを見る操作の所（押す所に、入力欄・選択肢を足したもの）
// 両方の確かめで食い違わないよう、ここにまとめる（PR #125 の ai-review の指摘）
const PRESSABLE = "button, [role=button], input[type=button], input[type=submit], input[type=checkbox], input[type=radio], a[href^='#']";
const CONTROLS = `${PRESSABLE}, input:not([type=hidden]), select, textarea`;

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

// opts: じっくり案件のデータ・人が入れた画像と、Google Fonts を使ってよいか（公開サイトの枠と同じ形で入れて動かす）
// short: 遊びの短いページで出すツール（決まった高さの画面で動かし、押す所が画面の中にあるかを見る）
export async function testTool(html: string, name: string, opts: { data?: unknown[]; fonts?: boolean; images?: ToolImages; short?: boolean } = {}): Promise<ToolTest> {
  const at = new Date().toISOString();
  const browser = await launch();
  if (typeof browser === "string") return { ok: true, skipped: browser, errors: [], clicked: 0, changed: false, overflow: false, at };
  try {
    const height = opts.short ? PLAY_MIN_HEIGHT : 812;
    const ctx = await browser.newContext({ viewport: { width: 375, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`エラー: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`コンソール: ${m.text()}`); });
    await page.setContent(wrapToolHtml(html, { data: opts.data, fonts: opts.fonts, images: opts.images }), { waitUntil: "load", timeout: 10_000 });
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => document.body.innerText);
    // 枠の中のスクリプトは、親の画面に「使った」を知らせる。テストでは枠に入れないので、自分あての知らせを受け取って数える
    // （setContent では addInitScript が効かないため、開いたあとに受け取り口を付ける。操作はこのあとに行う）
    await page.evaluate(() => {
      addEventListener("message", (e) => { if ((e.data as { __lab?: string } | null)?.__lab === "use") (window as unknown as { __labUsed?: boolean }).__labUsed = true; });
    });
    const offscreen = new Set<string>();
    if (opts.short) for (const x of await offscreenTargets(page)) offscreen.add(x);

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
    const targets = page.locator(PRESSABLE);
    const n = Math.min(await targets.count(), 20);
    let clicked = 0;
    for (let i = 0; i < n; i++) {
      const t = targets.nth(i);
      try {
        if (!(await t.isVisible())) continue;
        await t.click({ timeout: 1000 });
        clicked++;
        await page.waitForTimeout(150);
        if (opts.short) for (const x of await offscreenTargets(page)) offscreen.add(x);
      } catch {}
    }
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.body.innerText);
    // スマホの表示では画面の幅が中身に合わせて広がることがあるので、決まった幅（375px）と比べる
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 377);
    const used = await page.evaluate(() => !!(window as unknown as { __labUsed?: boolean }).__labUsed);

    const file = `${name.replace(/[^a-z0-9-]/gi, "_")}.png`;
    await page.screenshot({ path: path.join(dataDir("screenshots"), file), fullPage: true, timeout: 10_000 });
    const uniq = [...new Set(errors)].slice(0, 6).map((e) => e.slice(0, 300));
    const changed = before !== after;
    const off = [...offscreen].slice(0, 5);
    // 振って遊ぶツールは、開き直して、センサーを使うまで進めてから振る動きを流す（上の順に押す流れでは、一覧などが開いてセンサーまで届かないことがある）
    const motion = /labMotion|labmotion/.test(html) ? await motionCheck(ctx, html, opts) : undefined;
    return {
      ok: uniq.length === 0 && changed && !overflow && used && (motion?.ok ?? true) && off.length === 0,
      errors: uniq, clicked, changed, overflow, used, ...(motion ? { motion } : {}), ...(opts.short ? { offscreen: off } : {}), screenshot: file, at,
    };
  } catch (e) {
    return { ok: false, errors: [`テストの途中で失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`], clicked: 0, changed: false, overflow: false, at };
  } finally {
    await browser.close().catch(() => {});
  }
}

// 決まった高さの画面で、押す所（ボタンなど）が画面の下に出ていないか。名前を返す
// 画面がはみ出してスクロールできるとき（中身が画面より高いとき）だけ見る。はみ出していなければ、画面の外に動かして隠した画面（切り替えの途中など）なので数えない
// 中身をスクロールできる箱（一覧など）の中にあるものと、見えなくした画面（透明・hidden・aria-hidden・inert）の中にあるものも数えない
// （ブラウザに渡す関数の中では、名前を付けた関数を作らない。テストで動かすときに、ブラウザにない補助の関数が差し込まれるため）
async function offscreenTargets(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    if (Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) <= innerHeight + 1) return out;
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= innerHeight + 1) continue;
      let skip = false;
      for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) < 0.1 || p.getAttribute("aria-hidden") === "true" || p.hasAttribute("inert")) { skip = true; break; }
        if (p !== el && p !== document.body && (st.overflowY === "auto" || st.overflowY === "scroll") && p.scrollHeight > p.clientHeight + 1) { skip = true; break; }
      }
      if (!skip) out.push(((el as HTMLElement).innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).value || el.getAttribute("placeholder") || el.tagName.toLowerCase()).trim().slice(0, 20));
    }
    return out;
  }, CONTROLS);
}

// 開き直して、ツールが動きのセンサーを頼むまで進め（押せるボタンのうち、センサー・振る・傾けるなどの名前のものを先に、なければ並び順に押す。8回まで）、振る動きを流す
// 枠に入れないので、動きのセンサーの許可は「許可された」として答え、頼まれたかを覚える
// 最後まで頼まれなければ、確かめない（undefined）
async function motionCheck(ctx: BrowserContext, html: string, opts: { data?: unknown[]; fonts?: boolean; images?: ToolImages }): Promise<ToolTest["motion"]> {
  const page = await ctx.newPage();
  try {
    await page.setContent(wrapToolHtml(html, { data: opts.data, fonts: opts.fonts, images: opts.images }), { waitUntil: "load", timeout: 10_000 });
    await page.waitForTimeout(500);
    // 文字で渡す（オブジェクトに関数を書くと、テストで動かすときに、ブラウザにない補助の関数が差し込まれるため）
    await page.evaluate(`if (window.labMotion) window.labMotion = { request: function () { window.__labMotionAsked = true; return Promise.resolve("granted"); } };`);
    const asked = () => page.evaluate("!!window.__labMotionAsked") as Promise<boolean>;
    // 押したものは、そのときの画面の中身と組で覚える。画面の中身が変わったら、同じ名前のボタン（「次へ」など）もまた押せる（PR #125 の ai-review の指摘）
    const pressed = new Set<string>();
    for (let step = 0; step < 8 && !(await asked()); step++) {
      const state = (await page.evaluate("document.body.innerText")) as string;
      const buttons = page.locator(PRESSABLE);
      const names = await buttons.evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        // 押せるか: 画面の中にあり、真ん中を押したときに、ほかのもの（重なった別の画面など）に隠れていない
        const hit = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight ? document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, innerHeight - 1)) : null;
        const visible = !!hit && (hit === el || el.contains(hit)) && st.visibility !== "hidden" && Number(st.opacity) > 0.1;
        return visible ? ((el as HTMLElement).innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).value || "").trim() : null;
      }));
      // 名前のないものは、並びの番号で見分ける
      const key = (n: string, i: number) => `${n || `#${i}`}\u0000${state}`;
      const order = names.map((n, i) => ({ n, i })).filter((x): x is { n: string; i: number } => x.n !== null && !pressed.has(key(x.n, x.i)));
      const pick = order.find((x) => /センサー|振|ふる|ゆら|傾|かたむ|shake|motion|sensor/i.test(x.n)) ?? order[0];
      if (!pick) break;
      pressed.add(key(pick.n, pick.i));
      await buttons.nth(pick.i).click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    if (!(await asked())) return undefined;
    return await shakeCheck(page, ctx);
  } finally {
    await page.close();
  }
}

// 振る動きを流して、画面がどれだけ変わるかを見る
// 静かに持った動きを1秒流したときの変化（雪が降るなど、ひとりでに動く分）と、振る動きを1秒流したときの変化を比べる
async function shakeCheck(page: Page, ctx: BrowserContext): Promise<NonNullable<ToolTest["motion"]>> {
  const stream = (shake: boolean) => page.evaluate(async (shake) => {
    for (let i = 0; i < 60; i++) {
      const t = i / 60, a = shake ? 15 * Math.sin(2 * Math.PI * 4 * t) : 0;
      dispatchEvent(new CustomEvent("labmotion", { detail: { x: 0.1 + a, y: -9.6 + a * 0.4, z: 1.5 } }));
      await new Promise((r) => setTimeout(r, 16));
    }
  }, shake);
  await stream(false); // 重力をならす分
  const s0 = await page.screenshot({ scale: "css" });
  await stream(false);
  const s1 = await page.screenshot({ scale: "css" });
  await stream(true);
  const s2 = await page.screenshot({ scale: "css" });
  const idle = await diffRatio(ctx, s0, s1);
  const shake = await diffRatio(ctx, s1, s2);
  // 振ったときに、画面の1%以上が変わり、かつ待ったときの1.5倍以上変わること（#72 の直す前の版は、傾きで景色が少しずれるだけで 0.5% ほどだった）
  return { idle, shake, ok: shake >= Math.max(0.01, idle * 1.5) };
}

// 2枚の画面の画像で、はっきり色が変わった点の割合（0〜1）。画像の読み込みはブラウザに任せる
async function diffRatio(ctx: BrowserContext, a: Buffer, b: Buffer): Promise<number> {
  const p = await ctx.newPage();
  try {
    return await p.evaluate(async ([a, b]) => {
      const [ia, ib] = await Promise.all([a, b].map((src) => new Promise<HTMLImageElement>((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = src; })));
      const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
      const [da, db] = [ia, ib].map((img) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d")!; x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; });
      let changed = 0, n = 0;
      for (let i = 0; i < da.length; i += 8) {
        n++;
        if (Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])) > 32) changed++;
      }
      return n ? changed / n : 0;
    }, [`data:image/png;base64,${a.toString("base64")}`, `data:image/png;base64,${b.toString("base64")}`]);
  } finally {
    await p.close();
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
    ...(t.motion && !t.motion.ok ? [`スマホを振る動き（labmotion）を流しても、画面がほとんど変わらない（振らずに待ったときに変わった画面 ${pct(t.motion.idle)}・振ったとき ${pct(t.motion.shake)}）。振りの強さは、1つ前に届いた値との差で測らず、重力をならした値からのずれで測る`] : []),
    ...(t.offscreen?.length ? [`高さ${PLAY_MIN_HEIGHT}pxの画面で、押す所（${t.offscreen.map((x) => `「${x}」`).join("・")}）が画面の下に出ていて、スクロールしないと押せない。絵や盤面を画面の高さにも合わせて縮め、遊ぶのに要るものを1画面に入れる`] : []),
    ...(t.clicked > 0 && t.used === false ? ["操作しても「使った」と数えられない（画面全体のクリック・入力の知らせを止めない（stopPropagation などを window や document に付けない）。押す所は button 要素にする）"] : []),
  ];
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function screenshotPath(file: string): string | null {
  if (!/^[a-z0-9_-]+\.(png|jpg)$/i.test(file)) return null;
  const p = path.join(dataDir("screenshots"), file);
  return fs.existsSync(p) ? p : null;
}
