import { chromium, type Browser } from "playwright-core";

// 画面の確認・ツールの自動テスト・遊ぶ様子の動画・デザインの参考の取り込みで使うブラウザを開く
// 順番: Playwright に付いてくる Chromium（版が playwright-core と合っている）→ CHROMIUM_PATH → パソコンに入っている Google Chrome
// - 前は Google Chrome を先に使っていた。CI（GitHub の実行環境）の Chrome は GitHub 側で更新され、新しい版が、
//   隔離した枠（sandbox 付きの iframe に srcdoc を入れる形）で落ちることがあった（Check failed: has_site_）。
//   main の CI が落ちると Railway が出さなくなるので、版が決まっている Chromium を先に使う（2026-11-26。運営者が直すと決めた）
// - 本番（Railway の Docker）には Google Chrome がなく、もともと Playwright の Chromium を使っているので、本番の動きは変わらない
export async function launchBrowser(): Promise<Browser | null> {
  const tries = [
    () => chromium.launch({ headless: true }),
    ...(process.env.CHROMIUM_PATH ? [() => chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true })] : []),
    () => chromium.launch({ channel: "chrome", headless: true }),
  ];
  for (const t of tries) {
    try {
      return await t();
    } catch {}
  }
  return null;
}
