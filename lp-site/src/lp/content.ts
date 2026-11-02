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

export type Lp = {
  headline: string;
  subheadline: string;
  pains: string[];
  features: { title: string; body: string; icon?: IconName }[];
  cta: string;
  faq: { q: string; a: string }[];
  // ここから下は見た目を豊かにするための任意の要素（古いLPには無い）
  design?: { theme: ThemeName; layout: "center" | "split"; badge?: string };
  preview?: { title: string; kind: (typeof PREVIEW_KINDS)[number]; columns?: string[]; rows: string[][] };
  steps?: { title: string; body: string }[];
  beforeAfter?: { before: string[]; after: string[] };
  // 動くツールの案件だけ: ツール本体（1つのHTML）と、シェアするときの文
  tool?: { html: string; shareText: string };
};

// ツール本体の大きさの上限（文字数）
export const TOOL_HTML_MAX = 80_000;

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
    lp.design = {
      theme: v.design.theme as ThemeName,
      layout: v.design.layout === "split" ? "split" : "center",
      badge: isStr(v.design.badge) ? cut(v.design.badge, 30) : undefined,
    };
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
  if (isObj(v.tool) && isStr(v.tool.html) && v.tool.html.length <= TOOL_HTML_MAX) {
    lp.tool = { html: v.tool.html, shareText: isStr(v.tool.shareText) ? cut(v.tool.shareText, 100) : lp.headline };
  }
  return lp;
}
