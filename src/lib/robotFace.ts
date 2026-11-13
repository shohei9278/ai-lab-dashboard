// ロボット社員の画像（public/robots）の中の、黒い画面の位置（%）。動画の寸劇とオフィスの画面で同じものを使う
// ロボットはこの実験用のオリジナルの絵で、各社のロゴは使わない
export const ROBOT_FACE: Record<string, { cx: number; cy: number; w: number; h: number }> = {
  anthropic: { cx: 49.5, cy: 35.6, w: 64, h: 31 },
  openai: { cx: 49.5, cy: 41, w: 65, h: 31 },
  google: { cx: 51, cy: 42, w: 66, h: 30 },
};
