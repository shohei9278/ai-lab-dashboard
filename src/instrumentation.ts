// サーバー起動時に一度だけ呼ばれる。毎日の自動実行のタイマーを始める
// （Node.js 以外の実行環境に DB のコードを含めないよう、この if の中でだけ読み込む）
export async function register() {
  // AI_LAB_SCHEDULER=off のときは動かさない（サーバーに移したあと、このPCで二重に実行しないため）
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.AI_LAB_SCHEDULER !== "off") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
