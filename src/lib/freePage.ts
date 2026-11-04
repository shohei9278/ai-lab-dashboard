import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { callClaude, isObj, isStr, type ClaudeContent } from "./ai";
import { dataDir, type ProjectRow } from "./db";
import { PAGE_HTML_MAX, type Lp } from "../../lp-site/src/lp/content";
import { PAGE_RULES, imgOriginsOf, wrapPageHtml } from "../../lp-site/src/lp/pageHtml";

// 部品を選ぶ方式ではなく、AIにLPのHTMLを丸ごと自由に書かせる
// 1. 世界観を1つ決めて、ページ全体を書く
// 2. 機械のチェック（外部との通信・登録フォームの形）と、本物のブラウザでのスクリーンショット
// 3. スクリーンショットをAIが見て、崩れ・内容の問題を指摘する。問題があれば1回だけ直す
// 部品で作ったLP（文言・テーマ色・イラスト）を材料として渡し、うまくいかなければ部品のLPのまま使う

export type PageCheck = {
  kind: "page";
  ok: boolean;
  issues: string[];
  skipped?: string;
  shots: string[]; // dataDir("screenshots") の中のファイル名（スマホ幅で上から順に）
  pc?: string; // PC幅の一番上
  at: string;
};

const SYSTEM = `あなたは、SNSで「このLP強すぎる」と話題になるレベルのLPを作る、トップクラスのアートディレクター兼フロントエンドエンジニアです。
まだ存在しないサービスの「事前登録LP」を、1つのHTMLファイルとして書きます。

進め方:
1. まず、このサービスだけの「世界観」を1つ決める（例: 人物像、モチーフ、比喩）。見出し・各セクション・ボタンの文言・装飾まで、すべてをその世界観で貫く
2. 説明の横に、その世界観を表す小さなUIの演出（実際の画面風のモック、カード、ログ、チャットなど）をHTML/CSSで作る
3. 余白・文字の大きさの強弱・配色を作り込み、テンプレートに見えない、記憶に残る見た目にする

守ること:
- スマホ（幅375px）で最も美しく見えること。左右に必ず16px以上の余白をとる。PC（幅1280px）でも崩れないこと
- 外部ファイルは Google Fonts だけ使ってよい。画像は、指定されたイラストのURLがあればそれだけ使ってよい。ほかの装飾はCSS・インラインSVG・絵文字で作る
- fetch などの通信、localStorage・Cookie、alert、window.open、外部サイトへのリンクは使わない（隔離された枠の中で表示され、どれも動かない）。ページ内のリンクは href="#id" だけ
- 小さなアニメーション（スクロールで現れる、流れる文字など）は歓迎。ただし控えめに。スクロールで現れる演出は、JavaScriptが動かなくても最後は表示されるようにする
- お客様の声・導入実績・利用者数・効果の数字・受賞歴は、まだ無いサービスなので一切書かない（でっち上げ禁止）。画面のモックの中の数字や名前も、仮のものと分かる程度にする
- 「必ず」「誰でも」などの誇大表現を使わない。開発前のサービスなので、すぐ使えるかのように書かない
- 登録フォーム: ${PAGE_RULES.form}。送信の処理は書かない（こちらで差し込む）。ページ内の登録ボタンは href="#signup" のリンクにする
- ${PAGE_RULES.privacy}
- ${PAGE_RULES.operator}
- 送信後にこちらが表示する文 <p class="lab-done"> と、エラーの文 <p class="lab-error"> の見た目もCSSで決めておく
- <title> と <meta name="description">（ページの要約1文）を入れ、見出しの <h1> は1つだけにする
- 日本語で書く。HTML全体で10万文字以内
- 出力は <!doctype html> から始まるHTMLだけ。説明やコードブロックは付けない`;

function material(p: ProjectRow, lp: Lp): string {
  const ill = lp.design?.illustration;
  return `サービス名: ${p.title}
対象: ${p.target}
困りごと: ${p.problem}
解決策: ${p.solution}

文言の材料（コピーライターが書いたもの。世界観に合わせて書き直してよいが、内容の範囲は超えない）:
${JSON.stringify({ headline: lp.headline, subheadline: lp.subheadline, pains: lp.pains, features: lp.features, steps: lp.steps, faq: lp.faq, cta: lp.cta })}
${ill ? `\n使ってよいイラスト（横長の画像）: ${ill.url}（説明: ${ill.alt}）` : ""}`;
}

function extractHtml(text: string): string {
  const t = text.replace(/^\s*```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = t.search(/<!doctype html|<html/i);
  return start >= 0 ? t.slice(start) : t;
}

async function writePageHtml(p: ProjectRow, lp: Lp, opts: { prevHtml?: string; instruction?: string; issues?: string[]; keepCore?: boolean }): Promise<string> {
  const fix = opts.issues?.length
    ? `\n\n今のページに次の問題が見つかった。これを直したページ全体を出力すること（直す所以外はそのまま）:\n- ${opts.issues.join("\n- ")}`
    : "";
  const instr = opts.instruction
    ? `\n\n今回の修正指示: ${opts.instruction}\n${opts.keepCore ? "指示された所だけ直し、それ以外（世界観・見た目・文言）は今のページのまま残すこと。" : "世界観は保ったまま、指示に合わせて直すこと。"}ページ全体を出力すること。`
    : "";
  const text = await callClaude({
    purpose: opts.issues?.length ? "LPのデザイン修正" : "LPのデザイン",
    projectId: p.id,
    system: SYSTEM,
    content: [{ type: "text", text: `${material(p, lp)}${opts.prevHtml ? `\n\n今のページ:\n${opts.prevHtml}` : ""}${instr}${fix}` }],
    maxTokens: 64000,
  });
  return extractHtml(text);
}

// コードを読めば分かる問題（通信・外部の読み込み・登録フォームの形）
export function staticPageIssues(html: string): string[] {
  const issues: string[] = [];
  if (html.length > PAGE_HTML_MAX) issues.push(`HTMLが長すぎる（${html.length}文字。上限${PAGE_HTML_MAX}文字）`);
  const bad: [RegExp, string][] = [
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/, "外部と通信している"],
    [/<script[^>]*\bsrc\s*=/i, "外部のスクリプトを読み込んでいる"],
    [/localStorage|sessionStorage|document\.cookie|indexedDB/, "保存領域・Cookieを使っている（枠の中では動かない）"],
    [/\balert\s*\(|window\.open\s*\(|\btop\.location|parent\.location/, "alert・別ウィンドウ・ページの移動を使っている"],
    [/<iframe|<embed|<object/i, "iframe などの埋め込みを使っている"],
  ];
  for (const [re, msg] of bad) if (re.test(html)) issues.push(msg);
  for (const m of html.matchAll(/<link[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    if (!m[1].startsWith("https://fonts.googleapis.com/") && !m[1].startsWith("https://fonts.gstatic.com")) issues.push(`Google Fonts 以外のファイルを読み込んでいる: ${m[1].slice(0, 80)}`);
  }
  if (!/<form[^>]*id\s*=\s*["']signup["']/i.test(html)) issues.push('登録フォーム form id="signup" がない');
  if (!/<input[^>]*type\s*=\s*["']email["']/i.test(html)) issues.push("メールアドレスの入力欄がない");
  if (!/<input[^>]*name\s*=\s*["']consent["']/i.test(html)) issues.push('プライバシーポリシーへの同意の欄 name="consent" がない');
  if (!/data-lab\s*=\s*["']privacy["']/i.test(html)) issues.push('プライバシーポリシーへのリンク data-lab="privacy" がない');
  if (!/data-lab\s*=\s*["']operator["']/i.test(html)) issues.push('運営者名の欄 data-lab="operator" がない');
  if ((html.match(/<h1[\s>]/gi) ?? []).length !== 1) issues.push("見出しの h1 が1つではない");
  return [...new Set(issues)];
}

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
  return "確認用のブラウザ（Chrome）が見つからないため、スクリーンショットでの確認を飛ばしました";
}

type Shot = { file: string; data: string };

// 本物のブラウザで開いて、スマホ幅で上から順に、PC幅で一番上を撮る
async function shootPage(html: string, imgOrigins: string[], name: string): Promise<{ skipped?: string; sp: Shot[]; pc?: Shot; errors: string[]; overflow: boolean; text: string }> {
  const browser = await launch();
  if (typeof browser === "string") return { skipped: browser, sp: [], errors: [], overflow: false, text: "" };
  const dir = dataDir("screenshots");
  const base = name.replace(/[^a-z0-9-]/gi, "_");
  const save = (buf: Buffer, file: string): Shot => {
    fs.writeFileSync(path.join(dir, file), buf);
    return { file, data: buf.toString("base64") };
  };
  try {
    const errors: string[] = [];
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`エラー: ${e.message}`));
    await page.setContent(wrapPageHtml(html, { imgOrigins }), { waitUntil: "networkidle", timeout: 20_000 });
    await page.waitForTimeout(800);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const sp: Shot[] = [];
    // 長すぎるページは、最初の8画面分だけ見る
    for (let i = 0, y = 0; i < 8 && y < height; i++, y += 812) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(700);
      sp.push(save(await page.screenshot({ type: "jpeg", quality: 70 }), `${base}-sp${i + 1}.jpg`));
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 377);
    const text = (await page.evaluate(() => document.body.innerText)).slice(0, 6000);
    const pcPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pcPage.setContent(wrapPageHtml(html, { imgOrigins }), { waitUntil: "networkidle", timeout: 20_000 });
    await pcPage.waitForTimeout(800);
    const pc = save(await pcPage.screenshot({ type: "jpeg", quality: 70 }), `${base}-pc.jpg`);
    return { sp, pc, errors: [...new Set(errors)].slice(0, 5).map((e) => e.slice(0, 200)), overflow, text };
  } catch (e) {
    return { sp: [], errors: [`確認の途中で失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`], overflow: false, text: "" };
  } finally {
    await browser.close().catch(() => {});
  }
}

// スクリーンショットをAIが見て、崩れと内容の問題を指摘する
async function reviewShots(p: ProjectRow, shots: { sp: Shot[]; pc?: Shot; text: string }): Promise<string[]> {
  const img = (s: Shot) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: s.data } });
  const content: ClaudeContent = [
    { type: "text", text: `サービス: ${p.title}（対象: ${p.target}）\n解決策: ${p.solution}\n\n以下は、スマホ幅（375px）で上から順に撮った画面と、最後にPC幅（1280px）の一番上の画面です。` },
    ...shots.sp.flatMap((s, i) => [{ type: "text" as const, text: `スマホ ${i + 1}画面目` }, img(s)]),
    ...(shots.pc ? [{ type: "text" as const, text: "PC 一番上" }, img(shots.pc)] : []),
    { type: "text", text: `ページの文字（抜粋）:\n${shots.text}` },
  ];
  const out = await callClaude({
    purpose: "LPのデザイン確認",
    projectId: p.id,
    system: `あなたはLPの公開前チェック担当のアートディレクターです。画面を見て、次の点に当てはまるものだけを具体的に指摘します（場所と、どう直すか）。好みの問題や細かすぎる点は指摘しない。
- 見た目の崩れ: 文字や要素の重なり・はみ出し・画面の端にくっついている（左右の余白がない）・読めない色の組み合わせ・意図しない大きな空白・表示されていない部分
- 登録フォームが見つけにくい、押しにくい
- 架空の実績・お客様の声・利用者数・効果の数字の断言、誇大表現、開発前なのにすぐ使えるかのような書き方
- 対象読者からずれている
問題がなければ issues は空にする。
出力はJSONのみ: {"issues":["問題と直し方"]}`,
    content,
    maxTokens: 8000,
  });
  const t = out.replace(/```(?:json)?/g, "");
  try {
    const v = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as unknown;
    return isObj(v) && Array.isArray(v.issues) ? v.issues.filter(isStr).slice(0, 8).map((x) => x.slice(0, 300)) : [];
  } catch {
    return [];
  }
}

async function check(p: ProjectRow, html: string, imgOrigins: string[], name: string) {
  const fixed = staticPageIssues(html);
  const shots = await shootPage(html, imgOrigins, name);
  const browserIssues = [...shots.errors.map((e) => `ブラウザで開いたら出た${e}`), ...(shots.overflow ? ["スマホ幅（375px）で、横にはみ出している"] : [])];
  const seen = shots.sp.length ? await reviewShots(p, shots) : [];
  return { fixed, issues: [...fixed, ...browserIssues, ...seen], shots };
}

// ページを書いて確かめ、問題があれば1回だけ直す。外部との通信などの決まりを守れていなければ使わない（例外を投げる）
export async function buildPage(p: ProjectRow, lp: Lp, name: string, opts: { prevHtml?: string; instruction?: string; keepCore?: boolean } = {}): Promise<{ html: string; check: PageCheck }> {
  let html = await writePageHtml(p, lp, opts);
  let r = await check(p, html, imgOriginsOf(lp.design?.illustration?.url, html), name);
  if (r.issues.length) {
    html = await writePageHtml(p, lp, { prevHtml: html, issues: r.issues });
    r = await check(p, html, imgOriginsOf(lp.design?.illustration?.url, html), name);
  }
  if (r.fixed.length) throw new Error(`自由なデザインのページが決まりを守れていません: ${r.fixed.join(" / ")}`);
  return {
    html,
    check: {
      kind: "page", ok: r.issues.length === 0, issues: r.issues, skipped: r.shots.skipped,
      shots: r.shots.sp.map((s) => s.file), pc: r.shots.pc?.file, at: new Date().toISOString(),
    },
  };
}

// ページの中の見出しと要約を、シェア画像や検索結果に使う文言にそろえる
export function pageTexts(html: string): { headline?: string; subheadline?: string } {
  const clean = (s: string) => s.replace(/<br\s*\/?>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const desc = html.match(/<meta[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1];
  const headline = h1 ? clean(h1) : "";
  const subheadline = desc ? clean(desc) : "";
  return {
    headline: headline.length >= 4 && headline.length <= 120 ? headline : undefined,
    subheadline: subheadline.length >= 4 && subheadline.length <= 240 ? subheadline : undefined,
  };
}
