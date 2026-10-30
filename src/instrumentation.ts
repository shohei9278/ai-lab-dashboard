// サーバー起動時に一度だけ呼ばれる。毎日の自動実行のタイマーを始める
// （Node.js 以外の実行環境に DB のコードを含めないよう、この if の中でだけ読み込む）
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
