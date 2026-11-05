import { callJson, isObj, isStr } from "./ai";
import { db } from "./db";
import { listRefs, type RefTags } from "./designRefs";

// 探す場所: LPアーカイブ（rdlp.jp。絞り込みの番号でリンクを作る）と、SANKOU!（sankoudesign.com。サイト内検索の言葉だけ使う）
// デザインの参考で「足りないもの」をAIに挙げさせる。これから作りそうな案件と、今のライブラリの偏りを見比べて、
// 何を何件くらい集めるとよいかと、LPアーカイブの絞り込み済みのリンクを出す（集めるのはあなた）

// LPアーカイブ（rdlp.jp）の絞り込みの番号（サイトの絞り込みメニューの名前）
const IMAGE: Record<string, string> = {
  15: "マンガ・イラスト", 16: "和風", 17: "かっこいい", 18: "かわいい", 19: "にぎやか", 20: "シンプル", 21: "アート・芸術", 22: "キレイ", 23: "信頼・安心", 24: "健康・癒し",
  25: "力強い", 26: "派手", 27: "清潔", 28: "爽やか", 29: "神秘", 30: "高級・セレブ", 31: "オーガニック", 32: "ナチュラル", 33: "スタイリッシュ", 164: "透明感",
};
const COLOR: Record<string, string> = {
  1: "ベージュ", 2: "ゴールド", 3: "イエロー", 4: "オレンジ", 5: "カラフル", 6: "グリーン", 7: "グレー", 8: "パープル", 9: "ピンク", 10: "ブラウン", 11: "ブラック", 12: "ブルー", 13: "レッド", 14: "ホワイト",
};
// 業種は、このラボの案件に関係しそうなものだけ
const CAT: Record<string, string> = {
  34: "サービス・保険・金融", 36: "レンタル・代行・アウトソース", 37: "企業・会社・お店", 39: "イベント・キャンペーン・体験", 42: "インターネットサービス", 43: "予約・前売り・チケット",
  46: "デザイン・アプリ・システム", 47: "診断・マッチング・まとめ", 48: "イベント・キャンペーン・ギフト", 75: "日用雑貨", 76: "キッチン・バス用品", 77: "文房具・事務用品",
  81: "インテリア・家具・寝具", 87: "旅行・アウトドア", 91: "スポーツ", 104: "キッズ・ベビー・玩具", 107: "ペット・花・DIY工具", 111: "学び・教材", 113: "セミナー・資格取得",
  115: "食品", 119: "惣菜・おかず・料理", 128: "本・音楽・ゲーム", 146: "求人・採用関連", 148: "アルバイト採用", 154: "TV・映画・アニメ",
};

export type RefNeed = { what: string; why: string; count: number; keywords: string; url: string; sankouUrl?: string; have: number };
export type RefNeeds = { at: string; summary: string; needs: RefNeed[] };

const KEY = "refNeeds";

export function savedNeeds(): RefNeeds | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as RefNeeds) : null;
}

function archiveUrl(image?: string, color?: string, cat?: string): string {
  const q = new URLSearchParams();
  if (image && IMAGE[image]) q.set("lp_image", image);
  if (color && COLOR[color]) q.set("lp_color", color);
  if (cat && CAT[cat]) q.set("lp_cat", cat);
  return q.size ? `https://rdlp.jp/lp-archive/search?${q}` : "https://rdlp.jp/lp-archive/";
}

export async function makeNeeds(): Promise<RefNeeds> {
  const refs = listRefs().filter((r) => r.status === "ok");
  const lib = refs.map((r) => {
    const t = JSON.parse(r.tags ?? "{}") as RefTags;
    return `- ${t.mood} / ${t.industry} / ${t.palette}`;
  });
  // これから作りそうなもの: 公開中・作成中の事前登録LPと、最近のアイデアで点の高かったもの
  const projects = (db().prepare("SELECT title, target, solution, kind FROM projects WHERE demo = 0 AND stage IN ('idea', 'lp', 'live') ORDER BY id DESC LIMIT 10").all() as { title: string; target: string; solution: string; kind: string }[])
    .map((p) => `- ${p.title}（${p.kind === "tool" ? "ツール" : "事前登録LP"}）対象: ${p.target}`);
  const ideas = (db().prepare("SELECT title, payload FROM idea_candidates WHERE at >= datetime('now', '-14 days') ORDER BY avg_score DESC LIMIT 12").all() as { title: string; payload: string }[])
    .map((c) => { const i = JSON.parse(c.payload) as { target?: string; kind?: string }; return `- ${c.title}（${i.kind === "tool" ? "ツール" : "事前登録LP"}）対象: ${i.target ?? ""}`; });
  const list = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k}=${v}`).join(" / ");

  const out = await callJson<{ summary: string; needs: { what: string; why: string; count: number; keywords: string; image?: string | number; color?: string | number; cat?: string | number; sankou?: string }[] }>({
    purpose: "デザインの参考の不足の洗い出し",
    system: `あなたはアートディレクターです。AIが事前登録LPのページをデザインするときに見せる「参考のLP」のライブラリを育てます。
これから作りそうな案件と、今のライブラリの中身を見比べて、足りない参考を3〜6個挙げてください。
- what: どんなLPの参考がほしいか（雰囲気・業種・見せ方を具体的に。例「個人向けアプリの、やわらかく親しみのあるLP」）
- why: なぜ必要か（どの案件・どんな案件の傾向に効くか、今のライブラリに何が足りないか）
- count: 集める目安の件数（2〜6）
- keywords: LPアーカイブで探すときの目のつけどころ（短く）
- image / color / cat: LPアーカイブの絞り込みの番号（合うものだけ。合わなければ省く）
  雰囲気: ${list(IMAGE)}
  色: ${list(COLOR)}
  業種: ${list(CAT)}
- sankou: SANKOU!（Webデザインのギャラリー）のサイト内検索に入れる言葉を1つ（例「和風」「かわいい」「家事」「SaaS」）。短い一般的な言葉にする
- summary: 今のライブラリの状態を1〜2文で
ライブラリが空のときは、まず幅広くそろえるための基本の組み合わせを挙げる。重要な順に並べる。
形式: {"summary":"","needs":[{"what":"","why":"","count":3,"keywords":"","image":"23","color":"12","cat":"46","sankou":"和風"}]}`,
    user: `今のライブラリ（${refs.length}件）:\n${lib.join("\n") || "（まだなし）"}\n\n公開中・作成中の案件:\n${projects.join("\n") || "（なし）"}\n\n最近のアイデアで点の高かったもの:\n${ideas.join("\n") || "（なし）"}`,
    validate: (v): v is { summary: string; needs: { what: string; why: string; count: number; keywords: string }[] } =>
      isObj(v) && isStr(v.summary) && Array.isArray(v.needs) && v.needs.every((n) => isObj(n) && isStr(n.what)),
  });
  // いまのライブラリで、その「ほしいもの」に近いもの（雰囲気の言葉が重なるもの）の数
  const have = (what: string) => refs.filter((r) => Object.values(JSON.parse(r.tags ?? "{}") as RefTags).some((t) => t && what.split(/[・、の\s]+/).some((w) => w.length >= 2 && t.includes(w)))).length;
  const needs: RefNeeds = {
    at: new Date().toISOString(),
    summary: out.summary.slice(0, 300),
    needs: out.needs.slice(0, 6).map((n) => ({
      what: String(n.what).slice(0, 80), why: String(n.why ?? "").slice(0, 200), count: Math.max(1, Math.min(10, Number(n.count) || 3)),
      keywords: String(n.keywords ?? "").slice(0, 80),
      url: archiveUrl(n.image === undefined ? undefined : String(n.image), n.color === undefined ? undefined : String(n.color), n.cat === undefined ? undefined : String(n.cat)),
      // SANKOU! は分類の体系を写すことが禁止されているので、サイト内検索の言葉だけを使う
      sankouUrl: isStr(n.sankou) ? `https://sankoudesign.com/?s=${encodeURIComponent(n.sankou.trim().slice(0, 20))}` : undefined,
      have: have(String(n.what)),
    })),
  };
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(needs));
  return needs;
}
