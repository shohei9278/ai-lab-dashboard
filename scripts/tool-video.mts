// 公開中のツールを実際に操作して、縦長の短い動画（1080×1920・音なし）を作る。投稿は人が手で行う
// 使い方: npx tsx scripts/tool-video.mts p51   → data/videos/p51.mp4
// ローカルの ffmpeg を使う。公開ページの訪問・利用の数字に入らないよう、計測の通信は止める
import path from "node:path";
import { chromium, type Frame, type Page } from "playwright-core";
import { recordToMp4 } from "../src/lib/videoRender";

type Step = { caption?: string; run?: (t: Tool) => Promise<void>; hold?: number };
type Tool = { frame: Frame; page: Page; type: (sel: string, text: string) => Promise<void>; click: (sel: string) => Promise<void>; scrollTo: (sel: string, offset?: number) => Promise<void> };
type Scene = { url: string; brand: string; steps: Step[] };

const SCENES: Record<string, Scene> = {
  p51: {
    url: "https://hitoride.vercel.app/p51",
    brand: "手しごと値札電卓",
    steps: [
      { caption: "材料費だけで\n値段、決めてない？", hold: 2200 },
      { caption: "材料費・作る時間・\n手数料を入れる", run: async (t) => {
        await t.scrollTo("#ts-material", 60);
        await t.type("#ts-material", "800");
        await t.type("#ts-minutes", "90");
        await t.scrollTo("#ts-fee", 200);
        await t.type("#ts-fee", "10");
      }, hold: 700 },
      { caption: "守りたい時給から\n値段が出る", run: async (t) => { await t.scrollTo("#ts-download", 90); }, hold: 3000 },
      { caption: "登録なしで\nそのまま使えます", hold: 2200 },
    ],
  },
  p52: {
    url: "https://hitoride.vercel.app/p52",
    brand: "かぶらない席替えシャッフル",
    steps: [
      { caption: "席替えしても\nいつも同じ人の隣？", hold: 2200 },
      { caption: "名前と卓の数を\n入れて押すだけ", run: async (t) => {
        await t.scrollTo("#kswT", 120);
        await t.page.waitForTimeout(800);
        await t.scrollTo("#kswGo", 300);
        await t.click("#kswGo");
      }, hold: 1200 },
      { caption: "同じ人との同席を\nなるべく減らして組む", run: async (t) => { await t.scrollTo("#kswSaveCard", 350); }, hold: 3000 },
      { caption: "登録なしで\nそのまま使えます", hold: 2200 },
    ],
  },
};

const W = 1080, H = 1920, TOP = 380, BOTTOM = 180, SCALE = 2; // 実寸で開き、ツールの枠だけ2倍にして見せる

async function main() {
  const name = process.argv[2];
  const scene = SCENES[name];
  if (!scene) throw new Error(`使い方: tool-video.mts ${Object.keys(SCENES).join(" | ")}`);
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "light", locale: "ja-JP" });
  const page = await ctx.newPage();
  // 計測（POST と Google Analytics）は送らない
  await page.route("**/*", (r) => {
    const q = r.request();
    return q.method() !== "GET" || /google-analytics|googletagmanager/.test(q.url()) ? r.abort() : r.continue();
  });
  await page.goto(scene.url, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const frame = page.frames().find((f) => f.url() === "about:srcdoc");
  if (!frame) throw new Error("ツールの枠が見つかりません");

  // ツールだけを画面いっぱいに出し、上に字幕、下に案内を重ねる
  await page.addStyleTag({ content: `
    iframe{position:fixed!important;top:${TOP}px!important;left:0!important;width:${W / SCALE}px!important;height:${(H - TOP - BOTTOM) / SCALE}px!important;transform:scale(${SCALE});transform-origin:0 0;z-index:9000!important;border:0!important;background:#fff}
    #v-top,#v-bottom{position:fixed;left:0;width:${W}px;z-index:9001;display:flex;align-items:center;justify-content:center;text-align:center;font-family:"Hiragino Sans",sans-serif}
    #v-bg{position:fixed;inset:0;background:#fff;z-index:8999}
    #v-top{top:0;height:${TOP}px;background:#1a1a1a;color:#fff;font-size:72px;font-weight:800;line-height:1.35;padding:0 48px;white-space:pre-line;box-sizing:border-box}
    #v-bottom{bottom:0;height:${BOTTOM}px;background:#1a1a1a;color:#fff;font-size:44px;font-weight:700}
    #v-text{transition:opacity .18s}
  ` });
  await page.evaluate(({ brand }) => {
    document.body.insertAdjacentHTML("beforeend", `<div id="v-bg"></div><div id="v-top"><span id="v-text"></span></div><div id="v-bottom">${brand}</div>`);
    for (const el of [...document.querySelectorAll("body > *")] as HTMLElement[]) el.style.animation = "none";
  }, { brand: scene.brand });
  await frame.evaluate(() => { document.documentElement.style.overflow = "auto"; document.body.style.overflow = "visible"; });

  const tool: Tool = {
    frame, page,
    type: async (sel, text) => { const el = frame.locator(sel); await el.fill(""); await page.waitForTimeout(120); await el.pressSequentially(text, { delay: 170 }); await page.waitForTimeout(450); },
    click: async (sel) => { await frame.locator(sel).click(); await page.waitForTimeout(500); },
    scrollTo: async (sel, offset = 80) => {
      // ゆっくり動かす
      await frame.evaluate(async ({ sel, offset }) => {
        const target = document.querySelector(sel)!.getBoundingClientRect().top + scrollY - (innerHeight - offset);
        const y = Math.max(0, target), from = scrollY;
        for (let i = 1; i <= 40; i++) {
          const k = i / 40;
          scrollTo(0, from + (y - from) * (1 - (1 - k) ** 3));
          await new Promise((r) => requestAnimationFrame(r));
        }
      }, { sel, offset });
      await page.waitForTimeout(250);
    },
  };

  const setCaption = (text: string) => page.evaluate(async (t) => {
    const el = document.getElementById("v-text")!;
    el.style.opacity = "0";
    await new Promise((r) => setTimeout(r, 180));
    el.textContent = t;
    el.style.opacity = "1";
  }, text);
  const out = path.resolve("data/videos", `${name}.mp4`);
  await recordToMp4(page, async () => {
    for (const s of scene.steps) {
      if (s.caption) await setCaption(s.caption);
      await page.waitForTimeout(250);
      if (s.run) await s.run(tool);
      await page.waitForTimeout(s.hold ?? 1000);
    }
  }, out);
  await browser.close();
  console.log(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
