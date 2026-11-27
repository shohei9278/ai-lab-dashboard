// LPの中身と見た目の型。ダッシュボード（プレビュー・AIの出力の確認）と公開用LPサイトの両方で使う
// どちらの環境にも依存しないよう、ここでは外部のライブラリを読み込まない

export const THEMES = {
  // light / dark の色。アクセントは文字色との差が十分あるものだけ
  trust: { label: "信頼感（青）", accent: ["#1f62c4", "#5a9cf0"], soft: ["#eaf1fb", "#17243a"] },
  warm: { label: "あたたかい（オレンジ）", accent: ["#c4511a", "#f08a50"], soft: ["#fbefe7", "#3a2418"] },
  fresh: { label: "さわやか（緑）", accent: ["#137a52", "#3cc28c"], soft: ["#e6f5ee", "#15302a"] },
  pop: { label: "ポップ（ピンク）", accent: ["#c0306b", "#f06aa0"], soft: ["#fbe9f1", "#3a1a29"] },
  calm: { label: "落ち着き（紫）", accent: ["#5b48c2", "#9a8cf0"], soft: ["#efecfb", "#241f3d"] },
  bold: { label: "力強い（黒）", accent: ["#1a1a1a", "#f0efec"], soft: ["#f0efec", "#262624"] },
} as const;
export type ThemeName = keyof typeof THEMES;

export const ICONS = ["clock", "list", "bell", "chart", "calendar", "check", "users", "spark", "shield", "link", "mail", "phone", "search", "pen", "folder", "yen"] as const;
export type IconName = (typeof ICONS)[number];

export const PREVIEW_KINDS = ["list", "table", "chat", "form"] as const;

// 紹介イラストの画風。1つに固定すると世界観に合わない案件が出るので、ページを書くAIが案件ごとに選ぶ
export const ILLUSTRATION_STYLES = {
  photo: "写真のような静物",
  soft3d: "やわらかい立体",
  flat: "平らなイラスト",
  papercut: "切り絵",
  watercolor: "水彩",
} as const;
export type IllustrationStyle = keyof typeof ILLUSTRATION_STYLES;

// 見た目の部品。AIはこの中から組み合わせを選ぶ（自由なHTMLは書かせない）
export const DESIGN_OPTIONS = {
  layout: { center: "中央寄せ", split: "左に文章・右に画像や画面", band: "テーマ色の帯に白い文字", left: "左寄せの大きな見出し" },
  font: { gothic: "ゴシック（すっきり）", rounded: "丸ゴシック（やわらかい）", mincho: "明朝（上品・落ち着き）" },
  pattern: { none: "なし", dots: "ドット", grid: "方眼", diagonal: "斜めのストライプ" },
  corners: { round: "丸い角", square: "角ばった" },
  painStyle: { cards: "カード", bubbles: "吹き出し（本人の声のように）", checklist: "チェックリスト" },
  featureStyle: { cards: "カード", list: "アイコン付きの一覧", numbered: "大きな番号付き" },
} as const;
export const SECTIONS = ["pains", "beforeAfter", "features", "steps", "faq"] as const;
export type SectionKey = (typeof SECTIONS)[number];
type Opt<K extends keyof typeof DESIGN_OPTIONS> = keyof (typeof DESIGN_OPTIONS)[K];
export type Design = {
  theme: ThemeName;
  layout: Opt<"layout">;
  badge?: string;
  font: Opt<"font">;
  pattern: Opt<"pattern">;
  corners: Opt<"corners">;
  painStyle: Opt<"painStyle">;
  featureStyle: Opt<"featureStyle">;
  order: SectionKey[];
  illustration?: { url: string; alt: string }; // AIが描いたイラスト（システムが付ける）
};

export type Lp = {
  headline: string;
  subheadline: string;
  pains: string[];
  features: { title: string; body: string; icon?: IconName }[];
  cta: string;
  faq: { q: string; a: string }[];
  // ここから下は見た目を豊かにするための任意の要素（古いLPには無い）
  design?: Design;
  illustrationPrompt?: string; // イラストを描くAIへの指示（英語）。画像を作ったあとも残す
  illustrationStyle?: IllustrationStyle; // イラストの画風（古いLPには無い。無ければ平らなイラスト）
  // 動くツールの本物の画面（自動テストで撮った、何も押す前の1画面）。ダッシュボードが公開のときに入れる。一覧のカードとシェア画像に使う
  shot?: { url: string; width: number; height: number };
  preview?: { title: string; kind: (typeof PREVIEW_KINDS)[number]; columns?: string[]; rows: string[][] };
  steps?: { title: string; body: string }[];
  beforeAfter?: { before: string[]; after: string[] };
  // 動くツールの案件だけ: ツール本体（1つのHTML）と、シェアするときの文
  // じっくり案件のツールは、人が確かめたデータ（data。枠の中で window.labData として読める）と、Google Fonts を使ってよい印（fonts）を持つ
  // results: 結果の種類が決まっているツール（診断など）の結果の名前。シェアのリンク（?r=番号）と、結果ごとのシェア画像に使う
  // images: じっくり案件で人が入れた画像（素材）。名前 → 公開用の保存領域の URL。枠の中で window.labAssets.images として読める
  tool?: { html: string; shareText: string; data?: unknown[]; fonts?: boolean; results?: string[]; images?: ToolImages };
  // AIが丸ごと自由に書いたページ（1つのHTML）。あれば部品の表示の代わりにこれを出す。上の文言はシェア画像・検索結果・予備に使う
  page?: { html: string };
  // 動くツールの案件だけ: 紹介ページを作らず、名前と一行 → ツール → シェア の短い形で出す（ねらいが「広がる」「また来てもらう」のツール。ShortToolView）
  // 上の文言（見出し・特徴など）は、シェア画像・SNSの下書き・予備に使う
  short?: boolean;
};

// ツール本体の大きさの上限（文字数）
export const TOOL_HTML_MAX = 80_000;
// 結果の名前の数と長さの上限（シェア画像に大きく出すので短く）
export const TOOL_RESULTS_MAX = 40;
export const TOOL_RESULT_LEN = 30;
// 結果の一覧として正しいか: 1〜TOOL_RESULTS_MAX 個の、空でなく前後に空白のない TOOL_RESULT_LEN 文字以内の文字列
// ツールは番号（何番目か）で結果を知らせるので、要素を除いたり切ったり整えたりせず、1つでもおかしければ一覧ごと使わない
export function isToolResults(v: unknown): v is string[] {
  return Array.isArray(v) && v.length >= 1 && v.length <= TOOL_RESULTS_MAX
    && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= TOOL_RESULT_LEN && x === x.trim());
}
// じっくり案件のツールに付ける画像（素材）: 名前 → https の URL
// 名前は、ツールのコードで window.labAssets.images.名前 と書けるように、英小文字で始まる英小文字・数字・_ の24文字まで
export type ToolImages = Record<string, string>;
export const TOOL_IMAGES_MAX = 4;
export const TOOL_IMAGE_BYTES_MAX = 2 * 1024 * 1024;
export const TOOL_IMAGE_NAME = /^[a-z][a-z0-9_]{0,23}$/;
// 画像の一覧として正しいものだけを返す（名前の形・https の URL・数の上限。1つでもおかしければ使わない）
// allowData: 画像そのもの（data: の URL）も受け付ける（手元で Claude Code が確かめる play-check だけ。公開する版には入れない）
export function toolImagesOf(v: unknown, allowData = false): ToolImages | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const e = Object.entries(v as Record<string, unknown>);
  if (!e.length || e.length > TOOL_IMAGES_MAX) return undefined;
  const okUrl = (u: unknown) => typeof u === "string" && (/^https:\/\/[^\s"'<>]+$/.test(u) || (allowData && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u)));
  if (!e.every(([k, u]) => TOOL_IMAGE_NAME.test(k) && okUrl(u))) return undefined;
  return Object.fromEntries(e) as ToolImages;
}
// 結果の一覧を取り出す処理（hasResultsTag・toolResultsOf）は、HTMLのパーサーを使うので htmlDom.ts にある（画面のコードに入れない）

// AIが1回で書くじっくり案件のツールのコードの上限（データは別に置くので、コードだけで数える）。チェック（staticToolIssues）で止める
// 保存・公開の上限は、データがあってもなくても TOOL_HTML_MAX（Claude Code で作るツールは 80,000文字まで、と決めているため。
// 保存の所だけ 60,000文字のままで、Claude Code が作った約64,000文字のじっくり案件のツールが黙って捨てられた。#74）
// AIが書くときも TOOL_HTML_MAX にそろえた（11/27 に運営者が決めた。#64 で、AIが直した版が 61,139文字になり、6万文字のチェックで公開が止まった。
// 6万文字は、AIが1回で書き切れずに途中で切れるのを防ぐための値だったが、いまは書くときの出力の上限（48,000トークン）で8万文字まで書き切れる）
export const TOOL_DEEP_CODE_MAX = TOOL_HTML_MAX;
// じっくり案件のデータの上限（JSON にしたときの文字数）と件数
export const TOOL_DATA_MAX = 600_000;
export const TOOL_DATA_ROWS_MAX = 2_500;
// 自由に書いたページの大きさの上限（文字数）
export const PAGE_HTML_MAX = 150_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const cut = (s: string, n: number) => s.trim().slice(0, n);
const strs = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v.filter(isStr).slice(0, max).map((s) => cut(s, len)) : []);

// 必須の部分がそろっているか
export function isLpCore(v: unknown): boolean {
  return isObj(v) && isStr(v.headline) && isStr(v.subheadline) && isStr(v.cta) &&
    Array.isArray(v.pains) && v.pains.every(isStr) &&
    Array.isArray(v.features) && v.features.every((f) => isObj(f) && isStr(f.title) && isStr(f.body)) &&
    Array.isArray(v.faq) && v.faq.every((f) => isObj(f) && isStr(f.q) && isStr(f.a));
}

// AIの出力や保存済みのデータを、表示してよい形に整える（知らない値・長すぎる文は落とす）
export function normalizeLp(raw: unknown): Lp {
  const v = raw as Record<string, unknown>;
  const lp: Lp = {
    headline: cut(String(v.headline), 120),
    subheadline: cut(String(v.subheadline), 240),
    cta: cut(String(v.cta), 60),
    pains: strs(v.pains, 5, 160),
    features: (Array.isArray(v.features) ? v.features : []).filter((f) => isObj(f) && isStr(f.title) && isStr(f.body)).slice(0, 6)
      .map((f) => ({ title: cut(f.title as string, 60), body: cut(f.body as string, 240), icon: ICONS.includes(f.icon as IconName) ? (f.icon as IconName) : undefined })),
    faq: (Array.isArray(v.faq) ? v.faq : []).filter((f) => isObj(f) && isStr(f.q) && isStr(f.a)).slice(0, 6)
      .map((f) => ({ q: cut(f.q as string, 120), a: cut(f.a as string, 400) })),
  };
  if (isObj(v.design) && (v.design.theme as string) in THEMES) {
    const d = v.design;
    const pick = <K extends keyof typeof DESIGN_OPTIONS>(k: K, fallback: Opt<K>): Opt<K> =>
      typeof d[k] === "string" && (d[k] as string) in DESIGN_OPTIONS[k] ? (d[k] as Opt<K>) : fallback;
    const order = Array.isArray(d.order) ? [...new Set(d.order.filter((x): x is SectionKey => SECTIONS.includes(x as SectionKey)))] : [];
    const ill = isObj(d.illustration) && isStr(d.illustration.url) && /^https:\/\/[^\s"']+$/.test(d.illustration.url)
      ? { url: d.illustration.url, alt: isStr(d.illustration.alt) ? cut(d.illustration.alt, 100) : "" }
      : undefined;
    lp.design = {
      theme: d.theme as ThemeName,
      layout: pick("layout", "center"),
      badge: isStr(d.badge) ? cut(d.badge, 30) : undefined,
      font: pick("font", "gothic"),
      pattern: pick("pattern", "none"),
      corners: pick("corners", "round"),
      painStyle: pick("painStyle", "cards"),
      featureStyle: pick("featureStyle", "cards"),
      // 選ばれなかった部分も、決まった順で後ろに付ける（中身のない部分は、下の中身を整えたあとで外す）
      order: [...order, ...SECTIONS.filter((x) => !order.includes(x))],
      illustration: ill,
    };
  }
  if (isStr(v.illustrationPrompt)) lp.illustrationPrompt = cut(v.illustrationPrompt, 600);
  if (isStr(v.illustrationStyle) && Object.hasOwn(ILLUSTRATION_STYLES, v.illustrationStyle)) lp.illustrationStyle = v.illustrationStyle as IllustrationStyle;
  // 写真は、公開用の保存領域（Supabase）のものだけ受け取る
  if (isObj(v.shot) && isStr(v.shot.url) && v.shot.url.length <= 500 && /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//.test(v.shot.url)) {
    const w = Number(v.shot.width), h = Number(v.shot.height);
    if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 10000 && h <= 40000) lp.shot = { url: v.shot.url, width: w, height: h };
  }
  if (isObj(v.preview) && isStr(v.preview.title) && PREVIEW_KINDS.includes(v.preview.kind as never) && Array.isArray(v.preview.rows)) {
    const rows = v.preview.rows.filter((r) => Array.isArray(r)).slice(0, 6).map((r) => (r as unknown[]).map((c) => cut(String(c ?? ""), 40)).slice(0, 4));
    if (rows.length) {
      lp.preview = {
        title: cut(v.preview.title, 40),
        kind: v.preview.kind as (typeof PREVIEW_KINDS)[number],
        columns: strs(v.preview.columns, 4, 20),
        rows,
      };
    }
  }
  const steps = (Array.isArray(v.steps) ? v.steps : []).filter((s) => isObj(s) && isStr(s.title) && isStr(s.body)).slice(0, 4)
    .map((s) => ({ title: cut(s.title as string, 40), body: cut(s.body as string, 160) }));
  if (steps.length >= 2) lp.steps = steps;
  if (isObj(v.beforeAfter)) {
    const before = strs(v.beforeAfter.before, 4, 80);
    const after = strs(v.beforeAfter.after, 4, 80);
    if (before.length && after.length) lp.beforeAfter = { before, after };
  }
  // コードの上限は、データを持つツール（じっくり案件）も TOOL_HTML_MAX（受け付け・チェックと同じ。AIが1回で書くじっくり案件は、チェックで TOOL_DEEP_CODE_MAX に抑える）
  if (isObj(v.tool) && isStr(v.tool.html) && v.tool.html.trim() && v.tool.html.length <= TOOL_HTML_MAX) {
    lp.tool = { html: v.tool.html, shareText: isStr(v.tool.shareText) ? cut(v.tool.shareText, 100) : lp.headline };
    const data = v.tool.data;
    if (Array.isArray(data) && data.length > 0 && data.length <= TOOL_DATA_ROWS_MAX && JSON.stringify(data).length <= TOOL_DATA_MAX) lp.tool.data = data;
    if (v.tool.fonts === true) lp.tool.fonts = true;
    if (isToolResults(v.tool.results)) lp.tool.results = v.tool.results;
    const images = toolImagesOf(v.tool.images);
    if (images) lp.tool.images = images;
  }
  if (isObj(v.page) && isStr(v.page.html) && v.page.html.length <= PAGE_HTML_MAX) lp.page = { html: v.page.html };
  if (v.short === true && lp.tool) lp.short = true;
  // 表示順には、中身がある部分だけを残す（order に beforeAfter があるのに中身がなく、チェックで食い違いとされた。提案箱 #71）
  if (lp.design) lp.design.order = lp.design.order.filter((k) => hasSection(lp, k));
  return lp;
}

// その部分に、表示する中身があるか
function hasSection(lp: Lp, k: SectionKey): boolean {
  switch (k) {
    case "pains": return lp.pains.length > 0;
    case "beforeAfter": return !!lp.beforeAfter;
    case "features": return lp.features.length > 0;
    case "steps": return !!lp.steps;
    case "faq": return lp.faq.length > 0;
  }
}
