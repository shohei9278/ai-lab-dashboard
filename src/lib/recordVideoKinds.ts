// 実験の記録の動画の種類（画面でも使うので、サーバー専用の処理とは分けておく）
export const RECORD_VIDEO_KINDS = {
  day: "今日の結果",
  debate: "AI同士の議論",
  fail: "失敗談",
} as const;
export type RecordVideoKind = keyof typeof RECORD_VIDEO_KINDS;
