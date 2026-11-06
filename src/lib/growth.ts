// SNSの投稿先（人が手で投稿するときの選択肢にも使う）
// 以前の「集客の作戦」（AIが作る作戦のページ）は、毎日の計画と「効いた手」の集計に置き換えた

export const SNS_PLATFORMS = {
  x: "X",
  threads: "Threads",
  bluesky: "Bluesky",
  instagram: "Instagram",
  note: "note",
  facebook: "Facebook",
  line: "LINE（オープンチャットなど）",
  community: "コミュニティ・掲示板",
  other: "その他",
} as const;
export type SnsPlatform = keyof typeof SNS_PLATFORMS;
