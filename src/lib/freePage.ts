import { viralHints } from "./viralPosts";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { callClaude, callLong, callVision, isObj, isStr, type ClaudeContent } from "./ai";
import { getModel, hasKey } from "./models";
import { refImages, type DesignRef } from "./designRefs";
import { dataDir, getSettings, type ProjectRow } from "./db";
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

// 指示は部品に分けて持つ（プロンプトの比較で、部品を1つだけ差し替えられるように。ふだんは全部をこの順に使う）
const ROLE = "あなたは、SNSで「このLP強すぎる」と話題になるレベルのLPを作る、トップクラスのアートディレクター兼フロントエンドエンジニアです。\n";
const TASK = "まだ存在しないサービスの「事前登録LP」を、1つのHTMLファイルとして書きます。\n\n";
const STEPS = `進め方:
1. まず、このサービスだけの「世界観」を1つ決める（例: 人物像、モチーフ、比喩）。見出し・各セクション・ボタンの文言・装飾まで、すべてをその世界観で貫く
2. 説明の横に、その世界観を表す小さなUIの演出（実際の画面風のモック、カード、ログ、チャットなど）をHTML/CSSで作る
3. 余白・文字の大きさの強弱・配色を作り込み、テンプレートに見えない、記憶に残る見た目にする

`;
const RULES = `守ること:
- スマホ（幅375px）で最も美しく見えること。左右に必ず16px以上の余白をとる。PC（幅1280px）でも崩れないこと
- 外部ファイルは Google Fonts だけ使ってよい。画像は、指定されたイラストのURLがあればそれだけ使ってよい。ほかの装飾はCSS・インラインSVG・絵文字で作る
- fetch などの通信、localStorage・Cookie、alert、window.open、外部サイトへのリンクは使わない（隔離された枠の中で表示され、どれも動かない）。ページ内のリンクは href="#id" だけ
- 小さなアニメーション（スクロールで現れる、流れる文字など）は歓迎。ただし控えめに。スクロールで現れる演出は、JavaScriptが動かなくても最後は表示されるようにする
- お客様の声・導入実績・利用者数・効果の数字・受賞歴は、まだ無いサービスなので一切書かない（でっち上げ禁止）。画面のモックの中の数字や名前も、仮のものと分かる程度にする
- 「必ず」「誰でも」などの誇大表現を使わない。開発前のサービスなので、すぐ使えるかのように書かない
- まだ作ると決まっていないサービスで、このページは使いたい人がどれくらいいるかを確かめるためのもの。「開発中」「先行利用」「近日公開」「リリース予定」のように、作ることや提供の時期が決まっているかのようには書かない。「作るかどうかを決めるために、使ってみたい人を募っています」「提供することになったら、メールでお知らせします」のように、正直に書く
- 登録フォーム: ${PAGE_RULES.form}。送信の処理は書かない（こちらで差し込む）。ページ内の登録ボタンは href="#signup" のリンクにする
- ${PAGE_RULES.privacy}
- ${PAGE_RULES.operator}
- 送信後にこちらが表示する文 <p class="lab-done"> と、エラーの文 <p class="lab-error"> の見た目もCSSで決めておく
- <title> と <meta name="description">（ページの要約1文）を入れ、見出しの <h1> は1つだけにする
- 日本語で書く。HTML全体で10万文字以内
- 出力は <!doctype html> から始まるHTMLだけ。説明やコードブロックは付けない`;

// 守ることを短く整理した版（プロンプトの比較用）。動かすための決まりと、うそを書かない決まりは残し、言い回しを詰めた
const SHORT_RULES = `守ること:
- スマホ（375px）で一番きれいに。左右16px以上の余白。PC（1280px）でも崩れない
- 外部ファイルは Google Fonts と指定のイラストだけ。通信・保存領域・alert・別ページへのリンクは使わない（ページ内リンク href="#id" だけ）
- 実績・お客様の声・利用者数・効果の数字は書かない。誇大表現をしない。作ることや提供の時期が決まっているかのように書かない
- 登録フォーム: ${PAGE_RULES.form}。登録ボタンは href="#signup"。${PAGE_RULES.privacy}。${PAGE_RULES.operator}
- <p class="lab-done"> と <p class="lab-error"> の見た目を決める。<title>・<meta name="description">・<h1>1つを入れる
- 日本語・10万文字以内。出力は <!doctype html> から始まるHTMLだけ`;

// 対象者の目で考えてから書く（プロンプトの比較用）
const READER = `書き始める前に（頭の中で考え、出力には書かない）: このページの対象者になったつもりで、SNSのリンクからこのページを開いた最初の3秒で何を知りたいか、どこで「自分には関係ない」と帰りたくなるか、何があれば登録したくなるかを考える。その答えに合わせて、最初の画面と各セクションを組み立てる。

`;

export type PageVariant = { role?: boolean; shortRules?: boolean; reader?: boolean };
export function pageSystem(v: PageVariant = {}): string {
  return `${v.role === false ? "" : ROLE}${TASK}${v.reader ? READER : ""}${STEPS}${v.shortRules ? SHORT_RULES : RULES}`;
}
const SYSTEM = pageSystem();

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

// modelId を指定すると、そのAIが書く（別の会社のAIとの作り比べ用。指定しなければ Claude）
// system・effort・purpose は、プロンプトの比較で差し替えるときだけ渡す
export async function writePageHtml(p: ProjectRow, lp: Lp, opts: { prevHtml?: string; instruction?: string; issues?: string[]; keepCore?: boolean; refs?: DesignRef[]; modelId?: string; system?: string; effort?: "low" | "medium" | "high"; purpose?: string }): Promise<string> {
  const fix = opts.issues?.length
    ? `\n\n今のページに次の問題が見つかった。これを直したページ全体を出力すること（直す所以外はそのまま）:\n- ${opts.issues.join("\n- ")}`
    : "";
  const instr = opts.instruction
    ? `\n\n今回の修正指示: ${opts.instruction}\n${opts.keepCore ? "指示された所だけ直し、それ以外（世界観・見た目・文言）は今のページのまま残すこと。" : "世界観は保ったまま、指示に合わせて直すこと。"}ページ全体を出力すること。`
    : "";
  const purpose = opts.purpose ?? (opts.issues?.length ? "LPのデザイン修正" : "LPのデザイン");
  const system = opts.system ?? SYSTEM;
  const user = `${material(p, lp)}${opts.prevHtml ? `\n\n今のページ:\n${opts.prevHtml}` : viralHints("page")}${instr}${fix}`;
  if (opts.modelId && getModel(opts.modelId).provider !== "anthropic") {
    return extractHtml(await callLong({ modelId: opts.modelId, purpose, projectId: p.id, system, user, maxTokens: 64000, effort: opts.effort }));
  }
  const text = await callClaude({
    purpose,
    projectId: p.id,
    system,
    modelId: opts.modelId,
    effort: opts.effort,
    content: [
      { type: "text", text: user },
      // 参考のLP（雰囲気と質の水準を上げるため。配置・文言・画像はまねしない）
      ...(opts.refs?.length && !opts.issues?.length
        ? [
            { type: "text" as const, text: `\n参考にするLPの最初の画面（PC幅・スマホ幅）を${opts.refs.length}件見せます。プロのデザイナーが作った水準の例です。余白の取り方・文字の強弱・配色の絞り方・画面の密度など「質」を参考にし、このサービスの世界観に合わせて自分のデザインを作ること。配置・文言・画像・ロゴをそのまままねしないこと。\n${opts.refs.map((r, i) => `参考${i + 1}: ${r.note ?? ""}`).join("\n")}` },
            ...refImages(opts.refs),
          ]
        : []),
    ],
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

export async function launch(): Promise<Browser | string> {
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

// 運営者名は、公開サイトで表示するときに外から入れる。確認の画面でも同じように入れてから撮る（空欄の誤検知を防ぐ）
async function fillOperator(page: import("playwright-core").Page) {
  const name = getSettings().operatorName || "Hitoride";
  await page.evaluate((n) => document.querySelectorAll('[data-lab="operator"]').forEach((el) => { el.textContent = `運営: ${n}`; }), name);
}

// 本物のブラウザで開いて、スマホ幅で上から順に、PC幅で一番上を撮る
export async function shootPage(html: string, imgOrigins: string[], name: string): Promise<{ skipped?: string; sp: Shot[]; pc?: Shot; errors: string[]; overflow: boolean; text: string }> {
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
    await fillOperator(page);
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
    await fillOperator(pcPage);
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
- 「開発中」「先行利用」「近日公開」など、まだ作ると決まっていないのに、作ることや提供の時期が決まっているかのような書き方
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
// 直すときも、書いたのと同じAIが直す（作り比べの結果がそのAIの出来になるように）
export async function buildPage(p: ProjectRow, lp: Lp, name: string, opts: { prevHtml?: string; instruction?: string; keepCore?: boolean; refs?: DesignRef[]; modelId?: string } = {}): Promise<{ html: string; check: PageCheck }> {
  let html = await writePageHtml(p, lp, opts);
  let r = await check(p, html, imgOriginsOf(lp.design?.illustration?.url, html), name);
  if (r.issues.length) {
    html = await writePageHtml(p, lp, { prevHtml: html, issues: r.issues, modelId: opts.modelId });
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

// 採点するAI（3社）。作ったAIの会社の採点役が両方の案に1人ずつ付くので、身内びいきが打ち消し合う
export const PAGE_JUDGES = ["claude-opus-5-5", "gpt-5.6-sol", "gemini-3.1-pro-preview"];

export type PageJudge = { modelId: string; a: number; b: number; reason: string };

// 2つのページの画面を、どちらがどのAIの作か伏せて、3社のAIに別々に見比べさせる（スマホの最初の4画面とPCの最初の画面）。平均点の高い方を選ぶ
// names は理由の文の中の呼び名（X・Y は採点役ごとに並びが違うので、作ったAIの名前に置き換える）
export async function judgePages(p: ProjectRow, a: PageCheck, b: PageCheck, names = { a: "案A", b: "案B" }, purpose = "LPのデザインの採点"): Promise<{ winner: "a" | "b"; scoreA: number; scoreB: number; reason: string; judges: PageJudge[] }> {
  const dir = dataDir("screenshots");
  const imgs = (c: PageCheck): ClaudeContent =>
    [...c.shots.slice(0, 4), ...(c.pc ? [c.pc] : [])]
      .filter((f) => fs.existsSync(path.join(dir, f)))
      .map((f) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: fs.readFileSync(path.join(dir, f)).toString("base64") } }));
  const [ia, ib] = [imgs(a), imgs(b)];
  const system = `あなたは経験豊富なアートディレクターです。同じサービスの事前登録LPを、別々に作った2案（X と Y）の画面で見比べます。作り方は伏せてあります。
観点: 一目で何のサービスか分かるか / 対象読者（${p.target}）が自分ごとと感じて登録したくなるか / プロが作ったような質（余白・文字の強弱・配色・密度）か / 崩れや読みにくさがないか / テンプレートっぽさ・AIっぽさがないか
それぞれ1〜10点で、甘くしないこと（平凡なら5点前後）。
出力はJSONのみ: {"x":点数,"y":点数,"reason":"どちらがなぜ良いかを1〜2文で"}`;
  const ask = async (modelId: string): Promise<PageJudge> => {
    const flip = Math.random() < 0.5; // 並び順で見抜かれないように（採点役ごとに決める）
    const [x, y] = flip ? [ib, ia] : [ia, ib];
    const out = await callVision({
      modelId, purpose, projectId: p.id, system, maxTokens: 16000,
      content: [{ type: "text", text: "案X:" }, ...x, { type: "text", text: "案Y:" }, ...y],
    });
    const t = out.replace(/```(?:json)?/g, "");
    const v = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as { x?: number; y?: number; reason?: string };
    const sx = Math.max(1, Math.min(10, Number(v.x) || 5));
    const sy = Math.max(1, Math.min(10, Number(v.y) || 5));
    const [sa, sb] = flip ? [sy, sx] : [sx, sy];
    const [nx, ny] = flip ? [names.b, names.a] : [names.a, names.b];
    const reason = String(v.reason ?? "").replace(/案\s*([XY])|(?<![A-Za-z])([XY])(?![A-Za-z])/g, (_, c1, c2) => `「${(c1 ?? c2) === "X" ? nx : ny}」`);
    return { modelId, a: sa, b: sb, reason: reason.slice(0, 400) };
  };
  const usable = PAGE_JUDGES.filter((id) => hasKey(getModel(id).provider));
  const judges = (await Promise.allSettled(usable.map(ask))).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!judges.length) throw new Error("どのAIも採点できませんでした");
  const avg = (k: "a" | "b") => Math.round((judges.reduce((n, j) => n + j[k], 0) / judges.length) * 10) / 10;
  const [scoreA, scoreB] = [avg("a"), avg("b")];
  // 同点なら、どちらにも偏らないようくじで決める
  const winner = scoreA === scoreB ? (Math.random() < 0.5 ? "a" : "b") : scoreB > scoreA ? "b" : "a";
  const reason = judges.map((j) => `${getModel(j.modelId).label}: ${j.reason}`).join(" / ").slice(0, 900);
  return { winner, scoreA, scoreB, reason, judges };
}
