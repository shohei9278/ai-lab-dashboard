import { chromium, type Browser } from "playwright-core";

// 画面の確認・ツールの自動テスト・遊ぶ様子の動画・デザインの参考の取り込みで使うブラウザを開く
// 順番: Playwright に付いてくる Chromium（版が playwright-core と合っている）→ CHROMIUM_PATH → パソコンに入っている Google Chrome
// - 前は Google Chrome を先に使っていた。CI（GitHub の実行環境）の Chrome は GitHub 側で更新され、新しい版が、
//   隔離した枠（sandbox 付きの iframe に srcdoc を入れる形）で落ちることがあった（Check failed: has_site_）。
//   main の CI が落ちると Railway が出さなくなるので、版が決まっている Chromium を先に使う（2026-11-26。運営者が直すと決めた）
// - 本番（Railway の Docker）には Google Chrome がなく、もともと Playwright の Chromium を使っているので、本番の動きは変わらない
// - CI のテスト（AI_LAB_BROWSER_STRICT=1）では、Playwright の Chromium だけを使い、開けなければ元のエラーで落とす
//   （ほかのブラウザに切り替わってテストが通ると、Chromium で確かめたことにならない。PR #198 の ai-review の指摘）

export type BrowserTry = { name: string; launch: () => Promise<Browser> };

export function browserTries(env: NodeJS.ProcessEnv = process.env): BrowserTry[] {
  return [
    { name: "Playwright の Chromium", launch: () => chromium.launch({ headless: true }) },
    ...(env.CHROMIUM_PATH ? [{ name: "CHROMIUM_PATH", launch: () => chromium.launch({ executablePath: env.CHROMIUM_PATH, headless: true }) }] : []),
    { name: "Google Chrome", launch: () => chromium.launch({ channel: "chrome", headless: true }) },
  ];
}

// 順に試して、最初に開けたものを返す。すべて開けなければ、それぞれの理由を運用のログに残して null（呼び出し元は今までどおり飛ばす）
export async function openFirst(tries: BrowserTry[], strict = false): Promise<Browser | null> {
  const errors: string[] = [];
  for (const t of strict ? tries.slice(0, 1) : tries) {
    try {
      return await t.launch();
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300);
      if (strict) throw new Error(`${t.name}を開けませんでした（AI_LAB_BROWSER_STRICT のため、ほかのブラウザは使いません）: ${msg}`);
      errors.push(`${t.name}: ${msg}`);
    }
  }
  console.error(`ブラウザを開けませんでした\n${errors.map((x) => `- ${x}`).join("\n")}`);
  return null;
}

export function launchBrowser(): Promise<Browser | null> {
  return openFirst(browserTries(), process.env.AI_LAB_BROWSER_STRICT === "1");
}
