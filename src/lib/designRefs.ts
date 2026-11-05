import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { callClaude, isObj, isStr, type ClaudeContent } from "./ai";
import { dataDir, db } from "./db";
import { logEvent } from "./loop";

// デザインの参考のライブラリ
// あなたがブックマークレットやURLの一括貼り付けで送ったLPを、本物のブラウザで開いて PC幅・スマホ幅の最初の画面を撮り、
// AIが「雰囲気・業種・構成・配色・文字の印象」のタグと、どこが良いかのメモを付ける。
// ページを作るAIに「雰囲気と質の参考」として見せるだけで、公開サイトには載せない

export type DesignRef = {
  id: number; at: string; url: string; title: string | null; status: "queued" | "ok" | "error"; error: string | null;
  shot_pc: string | null; shot_sp: string | null; tags: string | null; note: string | null; used: number;
};
export type RefTags = { mood: string; industry: string; layout: string; palette: string; typography: string };

export function listRefs(): DesignRef[] {
  return db().prepare("SELECT * FROM design_refs ORDER BY id DESC").all() as DesignRef[];
}

export function refShotPath(file: string): string | null {
  if (!/^ref-\d+-(pc|sp)\.jpg$/.test(file)) return null;
  const p = path.join(dataDir("refs"), file);
  return fs.existsSync(p) ? p : null;
}

// URLを受け付ける（重複は無視）。取り込みは後ろで1件ずつ行う
export function queueRefs(urls: string[]): number {
  let n = 0;
  for (const raw of urls) {
    const url = raw.trim();
    if (!/^https:\/\/[^\s]+$/.test(url) || /rdlp\.jp\/lp-archive/.test(url)) continue; // まとめサイトそのものは取り込まない（元のLPのURLを送る）
    n += db().prepare("INSERT OR IGNORE INTO design_refs (url) VALUES (?)").run(url.slice(0, 500)).changes;
  }
  if (n) void processQueue();
  return n;
}

export function deleteRef(id: number) {
  const r = db().prepare("SELECT * FROM design_refs WHERE id = ?").get(id) as DesignRef | undefined;
  if (!r) return;
  for (const f of [r.shot_pc, r.shot_sp]) if (f) fs.rmSync(path.join(dataDir("refs"), f), { force: true });
  db().prepare("DELETE FROM design_refs WHERE id = ?").run(id);
}

const g = globalThis as unknown as { __aiLabRefQueue?: boolean };

async function processQueue() {
  if (g.__aiLabRefQueue) return;
  g.__aiLabRefQueue = true;
  try {
    for (;;) {
      const r = db().prepare("SELECT * FROM design_refs WHERE status = 'queued' ORDER BY id LIMIT 1").get() as DesignRef | undefined;
      if (!r) break;
      try {
        await capture(r);
      } catch (e) {
        db().prepare("UPDATE design_refs SET status = 'error', error = ? WHERE id = ?").run((e instanceof Error ? e.message : String(e)).slice(0, 300), r.id);
      }
    }
  } finally {
    g.__aiLabRefQueue = false;
  }
}

async function capture(r: DesignRef) {
  const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
  const dir = dataDir("refs");
  let title = "";
  const shots: Record<"pc" | "sp", Buffer> = {} as Record<"pc" | "sp", Buffer>;
  try {
    for (const [kind, viewport, mobile] of [["pc", { width: 1280, height: 800 }, false], ["sp", { width: 390, height: 844 }, true]] as const) {
      const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, locale: "ja-JP" });
      const page = await ctx.newPage();
      await page.goto(r.url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => page.waitForTimeout(3000));
      await page.waitForTimeout(1500);
      if (!title) title = (await page.title()).slice(0, 120);
      shots[kind] = await page.screenshot({ type: "jpeg", quality: 75 });
      fs.writeFileSync(path.join(dir, `ref-${r.id}-${kind}.jpg`), shots[kind]);
      await ctx.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const img = (b: Buffer) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: b.toString("base64") } });
  const content: ClaudeContent = [
    { type: "text", text: `ページ: ${title}（${r.url}）\nPC幅の最初の画面:` }, img(shots.pc),
    { type: "text", text: "スマホ幅の最初の画面:" }, img(shots.sp),
  ];
  const out = await callClaude({
    purpose: "デザインの参考のタグ付け",
    system: `あなたはWebデザイナーです。ランディングページの最初の画面を見て、ほかのページを作るときの参考として使えるように、短いタグとメモを付けます。
- mood: 雰囲気（例: 落ち着き・信頼 / 親しみ・やわらか / 力強い・大胆 / 遊び心 / 上品・高級感 / ミニマル）
- industry: 業種・対象（例: BtoB SaaS / 美容 / 教育 / 飲食 / 個人向けアプリ）
- layout: 最初の画面の構成（例: 左に大きな見出し・右に画面イメージ / 中央寄せ / 写真を全面）
- palette: 配色（例: 白地に紺と黄色のアクセント）
- typography: 文字の印象（例: 太いゴシックの大きな見出し / 明朝で上品）
- note: このページの、まねしたい良い点を1〜2文（具体的に。余白・文字の強弱・写真や図の使い方など）
ページが読み込めていない・LPではない場合は note に「参考にならない」と書く。
出力はJSONのみ: {"mood":"","industry":"","layout":"","palette":"","typography":"","note":""}`,
    content,
    maxTokens: 4000,
  });
  const t = out.replace(/```(?:json)?/g, "");
  const v = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as Record<string, unknown>;
  if (!isObj(v) || !isStr(v.note)) throw new Error("タグを読み取れませんでした");
  const tags: RefTags = { mood: String(v.mood ?? ""), industry: String(v.industry ?? ""), layout: String(v.layout ?? ""), palette: String(v.palette ?? ""), typography: String(v.typography ?? "") };
  const useless = /参考にならない/.test(v.note);
  db().prepare("UPDATE design_refs SET status = ?, error = ?, title = ?, shot_pc = ?, shot_sp = ?, tags = ?, note = ? WHERE id = ?")
    .run(useless ? "error" : "ok", useless ? "LPとして読み込めませんでした" : null, title, `ref-${r.id}-pc.jpg`, `ref-${r.id}-sp.jpg`, JSON.stringify(tags), String(v.note).slice(0, 300), r.id);
  if (!useless) logEvent(null, "system", "design-ref", `デザインの参考を追加: ${title || r.url}`);
}

// 案件に合う参考を選ぶ（タグの文字が、方向性・対象・業種と重なるものを優先し、使った回数が少ないものを先に）
export function pickRefs(hint: string, count = 3): (DesignRef & { tagsObj: RefTags })[] {
  const refs = (db().prepare("SELECT * FROM design_refs WHERE status = 'ok'").all() as DesignRef[]).map((r) => ({ ...r, tagsObj: JSON.parse(r.tags ?? "{}") as RefTags }));
  if (refs.length < 2) return [];
  const words = hint.split(/[\s・、。/（）()「」]+/).filter((w) => w.length >= 2);
  const score = (r: (typeof refs)[number]) => {
    const text = Object.values(r.tagsObj).join(" ") + (r.note ?? "");
    return words.filter((w) => text.includes(w)).length * 2 - r.used * 0.5 + Math.random();
  };
  return refs.sort((a, b) => score(b) - score(a)).slice(0, count);
}

export function markRefsUsed(ids: number[]) {
  for (const id of ids) db().prepare("UPDATE design_refs SET used = used + 1 WHERE id = ?").run(id);
}

export function refImages(refs: DesignRef[]): ClaudeContent {
  const out: ClaudeContent = [];
  for (const r of refs) {
    for (const f of [r.shot_pc, r.shot_sp]) {
      const p = f ? refShotPath(f) : null;
      if (p) out.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(p).toString("base64") } });
    }
  }
  return out;
}

// サーバーが止まっていたあいだに受け付けた分も、起動したら取り込む
export function resumeRefQueue() {
  if ((db().prepare("SELECT 1 FROM design_refs WHERE status = 'queued' LIMIT 1").get())) void processQueue();
}
