// 公開サイトの一覧で、ツールに付けるカテゴリ（来た人が探すときの、中身の種類）
// ダッシュボードが公開するときに、軽いAIがツールの名前と中身から1つ選び（運営者が選び直すこともできる）、公開の中身（content.category）に入れる。
// アイデア出しには使わない（決まった一覧を見せると、アイデアの幅が狭まるため）。増やすときは、ここに足すだけでよい
// ダッシュボードもこのファイルを読む（同じ一覧を2か所に書かない）

export const SITE_CATEGORIES = {
  shindan: { label: "診断・占い", hint: "質問に答えると、タイプや結果が出る" },
  game: { label: "ゲーム", hint: "操作して遊ぶ。点数・クリア・対戦など" },
  quiz: { label: "クイズ・テスト", hint: "知識・目・反射などを試して、どれだけできるかが出る" },
  maker: { label: "メーカー", hint: "選んだり入れたりすると、画像・カード・シートができる" },
  words: { label: "文章・ことば", hint: "文・あいさつ・名前などの、ことばを作る・遊ぶ" },
  calc: { label: "計算・見積もり", hint: "数を入れると、金額・量・時間などを計算する" },
  organize: { label: "段取り・整理", hint: "くじ・組み分け・予定・リストなどを決める・まとめる" },
  visual: { label: "見て楽しむ", hint: "図解・データ・眺めて楽しむもの" },
} as const;

export type SiteCategory = keyof typeof SITE_CATEGORIES;
// 一覧（絞り込みのボタン）に並べる順
export const SITE_CATEGORY_KEYS = Object.keys(SITE_CATEGORIES) as SiteCategory[];
export const isSiteCategory = (v: unknown): v is SiteCategory => typeof v === "string" && Object.hasOwn(SITE_CATEGORIES, v);
