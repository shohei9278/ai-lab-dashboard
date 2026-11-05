import { db } from "./db";
import { jstDate } from "./format";

// 無料で取れる「世の中の話題」。どちらも公開されている RSS を、1日1回だけ読む
// - Googleトレンドの急上昇ワード（日本）: いま検索されている言葉
// - はてなブックマークの人気エントリー（総合・暮らし・テクノロジー・政治と経済）: いま読まれている記事

export type TrendItem = { title: string; source: "google" | "hatena"; traffic?: string; count?: number; category?: string; news?: string; url?: string };

const HATENA_CATEGORIES = { all: "総合", life: "暮らし", it: "テクノロジー", economics: "政治と経済" } as const;

// RSS の文字を読める形に戻す（&#x...; や &amp; など）
function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();
}
const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "ai-product-lab (trend reader)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} から取れませんでした（${res.status}）`);
  return res.text();
}

async function fetchGoogle(): Promise<TrendItem[]> {
  const xml = await get("https://trends.google.com/trending/rss?geo=JP");
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20).map(([, it]) => ({
    source: "google" as const,
    title: tag(it, "title"),
    traffic: tag(it, "ht:approx_traffic"),
    news: tag(it, "ht:news_item_title") || undefined,
  })).filter((x) => x.title);
}

async function fetchHatena(): Promise<TrendItem[]> {
  const out: TrendItem[] = [];
  for (const [key, label] of Object.entries(HATENA_CATEGORIES)) {
    const xml = await get(`https://b.hatena.ne.jp/hotentry/${key}.rss`);
    const items = [...xml.matchAll(/<item [^>]*>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
      source: "hatena" as const,
      category: label,
      title: tag(it, "title"),
      url: tag(it, "link"),
      count: Number(tag(it, "hatena:bookmarkcount")) || 0,
    }));
    out.push(...items.filter((x) => x.title).sort((a, b) => b.count - a.count).slice(0, 10));
  }
  return out;
}

// 新しく取り直して保存する（取れなかった方は、前回の分を使い続ける）。古いものは2週間で消す
export async function refreshTrends(): Promise<{ google: number; hatena: number; errors: string[] }> {
  const errors: string[] = [];
  const save = db().prepare("INSERT INTO trend_snapshots (source, items) VALUES (?, ?)");
  const counts = { google: 0, hatena: 0 };
  for (const [source, fn] of [["google", fetchGoogle], ["hatena", fetchHatena]] as const) {
    try {
      const items = await fn();
      save.run(source, JSON.stringify(items));
      counts[source] = items.length;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  db().prepare("DELETE FROM trend_snapshots WHERE fetched_at < datetime('now', '-14 days')").run();
  return { ...counts, errors };
}

export function latestTrends(): { fetchedAt: string | null; items: TrendItem[] } {
  const rows = db()
    .prepare("SELECT source, items, fetched_at FROM trend_snapshots WHERE id IN (SELECT MAX(id) FROM trend_snapshots GROUP BY source)")
    .all() as { source: string; items: string; fetched_at: string }[];
  return {
    fetchedAt: rows.map((r) => r.fetched_at).sort().at(-1) ?? null,
    items: rows.flatMap((r) => JSON.parse(r.items) as TrendItem[]),
  };
}

// 最後に取ってから20時間以上たっていたら取り直す（スケジューラーから呼ぶ）
export async function maybeRefreshTrends() {
  const last = db().prepare("SELECT MAX(fetched_at) AS t FROM trend_snapshots").get() as { t: string | null };
  if (last.t && Date.now() - Date.parse(last.t.replace(" ", "T") + "Z") < 20 * 3600_000) return;
  await refreshTrends();
}

// AIに渡す文章
export function trendsText(): string {
  const { fetchedAt, items } = latestTrends();
  if (!items.length) return "";
  const google = items.filter((x) => x.source === "google").slice(0, 15).map((x) => `${x.title}${x.traffic ? `（${x.traffic}）` : ""}`);
  const byCat = new Map<string, string[]>();
  for (const x of items.filter((i) => i.source === "hatena")) byCat.set(x.category!, [...(byCat.get(x.category!) ?? []), x.title]);
  return [
    `いま世の中で話題のこと（${jstDate(fetchedAt)} に自動取得）:`,
    google.length ? `- Googleで急に検索が増えている言葉: ${google.join("、")}` : "",
    ...[...byCat].map(([cat, titles]) => `- はてなブックマークでよく読まれている記事（${cat}）: ${titles.slice(0, 6).map((t) => t.slice(0, 60)).join(" / ")}`),
  ].filter(Boolean).join("\n");
}
