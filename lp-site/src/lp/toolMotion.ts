// スマホの動き（振る・傾ける）を、公開ページの側で受け取って枠の中のツールに渡す（window.labMotion）
// 運営者の依頼（#72）: iPhone では、隔離された枠（別のサイト扱い）の中から動きのセンサーの許可を求めると、画面を出さずに断られる
// （「センサーが許可されませんでした」）。そこで、許可はページの側で求め、受け取った動きの知らせを枠に渡す
// - 枠の中: window.labMotion.request() で許可を頼み（"granted"・"denied"・"unavailable"）、"labmotion" イベントで動きを受け取る
// - ページの側（ToolFrame）: 許可が要らない端末（Android など）はすぐ渡す。iPhone など許可が要る端末は、まず求めてみて、
//   断られたら枠の上に「センサーを使う」ボタンを出す（ページの側でのタップでないと、iPhone は許可の画面を出さない）
// 外部のライブラリを読み込まない（枠の中とページの両方の決まりをここにまとめる）

export type MotionState = "granted" | "denied" | "unavailable";
type MotionApi = { requestPermission?: () => Promise<string> } | undefined;

// どう許可を取るか: none（センサーがない）・direct（許可が要らない）・ask（許可を求める）
export function motionPath(api: MotionApi): "none" | "direct" | "ask" {
  if (!api) return "none";
  return typeof api.requestPermission === "function" ? "ask" : "direct";
}

// 許可を求めた結果を、枠に返す形にする（"granted" 以外は断られた扱い）
export const motionStateOf = (r: unknown): MotionState => (r === "granted" ? "granted" : "denied");

// 動きの知らせ（重力を含む加速度 m/s²）を、枠に渡す形にする。値がない知らせは渡さない
export function motionMessage(a: { x: number | null; y: number | null; z: number | null } | null | undefined): { __lab: "motion"; x: number; y: number; z: number } | null {
  if (!a || typeof a.x !== "number" || typeof a.y !== "number") return null;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { __lab: "motion", x: r(a.x), y: r(a.y), z: r(typeof a.z === "number" ? a.z : 0) };
}
