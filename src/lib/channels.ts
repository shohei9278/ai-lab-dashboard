// どこから来たか（流入元）を分け、流入元ごとにページの中でどこまで進んだかを数える
// - SNSの投稿ごとの専用リンク（?s=…）から来た人は、その投稿の場所（X・Threads・Bluesky）にする
//   （Threads から来た人は、来た元のページが facebook.com と記録されるため、専用リンクを優先する）
// - 専用リンクがないときだけ、来た元のページ（referrer）のサイトで分ける。サイト名だけを使い、URLの残りは保存も表示もしない

export type ChannelKey = "x" | "threads" | "bluesky" | "index" | "search" | "meta" | "site" | "direct" | "other";
export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  x: "X", threads: "Threads", bluesky: "Bluesky", index: "公開サイトの一覧", search: "検索",
  meta: "Facebook・Instagram", site: "公開サイトの中", direct: "直接・不明", other: "ほかのサイト",
};

export type View = { version: number; visitor_id: string; source?: string | null; referrer?: string | null };
export type Event = { version: number; visitor_id: string; name?: string; detail?: string };
export type Conv = { version: number; visitor_id?: string | null };
export type ChannelStep = { key: string; label: string };
export type ChannelRow = { key: ChannelKey; label: string; host?: string; visitors: number; steps: Record<string, number> };

export const hostOf = (referrer?: string | null): string | null => {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
};

const has = (host: string, ...names: string[]) => names.some((n) => host === n || host.endsWith(`.${n}`));

export function channelOf(view: Pick<View, "source" | "referrer">, postPlatform: Map<string, string>, siteHost?: string | null): { key: ChannelKey; host?: string } {
  if (view.source === "index") return { key: "index" };
  const platform = view.source ? postPlatform.get(view.source) : undefined;
  if (platform === "x" || platform === "threads" || platform === "bluesky") return { key: platform };
  const host = hostOf(view.referrer);
  if (!host) return { key: "direct" };
  if (siteHost && host === siteHost) return { key: "site" };
  if (has(host, "t.co", "x.com", "twitter.com")) return { key: "x" };
  if (has(host, "threads.net", "threads.com")) return { key: "threads" };
  if (has(host, "bsky.app")) return { key: "bluesky" };
  if (has(host, "facebook.com", "instagram.com")) return { key: "meta" };
  if (/(^|\.)google\.|(^|\.)bing\.com$|(^|\.)yahoo\.|(^|\.)duckduckgo\.com$|(^|\.)ecosia\.org$/.test(host)) return { key: "search" };
  return { key: "other", host };
}

export const channelSteps = (isTool: boolean): ChannelStep[] => isTool
  ? [{ key: "tool_view", label: "ツールが画面に入った" }, { key: "conv", label: "ツールを操作した" }]
  : [{ key: "half", label: "半分まで読んだ" }, { key: "cta", label: "登録ボタンを押した" }, { key: "conv", label: "事前登録した" }];

// 版ごとに、流入元ごとの人数と、各段まで進んだ人数を数える。1人の流入元は、その版で最初に来たときのもの
export function channelStats(views: View[], events: Event[], conv: Conv[], postPlatform: Map<string, string>, isTool: boolean, siteHost?: string | null): Map<number, ChannelRow[]> {
  const out = new Map<number, ChannelRow[]>();
  const versions = [...new Set(views.map((v) => v.version))];
  for (const version of versions) {
    const first = new Map<string, { key: ChannelKey; host?: string }>();
    for (const v of views) if (v.version === version && !first.has(v.visitor_id)) first.set(v.visitor_id, channelOf(v, postPlatform, siteHost));
    const reached: Record<string, Set<string>> = {
      tool_view: new Set(events.filter((e) => e.version === version && e.name === "section_view" && e.detail === "tool").map((e) => e.visitor_id)),
      half: new Set(events.filter((e) => e.version === version && e.name === "scroll_depth" && Number(e.detail) >= 50).map((e) => e.visitor_id)),
      cta: new Set(events.filter((e) => e.version === version && e.name === "cta_click").map((e) => e.visitor_id)),
      conv: new Set(conv.filter((c) => c.version === version && c.visitor_id).map((c) => c.visitor_id as string)),
    };
    const rows = new Map<string, ChannelRow>();
    for (const [visitor, ch] of first) {
      const id = ch.key === "other" ? `other:${ch.host}` : ch.key;
      const row = rows.get(id) ?? { key: ch.key, label: ch.key === "other" ? ch.host! : CHANNEL_LABEL[ch.key], host: ch.host, visitors: 0, steps: {} };
      row.visitors++;
      for (const s of channelSteps(isTool)) if (reached[s.key].has(visitor)) row.steps[s.key] = (row.steps[s.key] ?? 0) + 1;
      rows.set(id, row);
    }
    out.set(version, [...rows.values()].sort((a, b) => b.visitors - a.visitors));
  }
  return out;
}

// 来訪者には、ほかのサイトの名前を出さずに1行にまとめる（個人のサイトの名前が出ないように）
export function maskChannels(rows: ChannelRow[]): ChannelRow[] {
  const others = rows.filter((r) => r.key === "other");
  if (!others.length) return rows;
  const merged: ChannelRow = { key: "other", label: CHANNEL_LABEL.other, visitors: 0, steps: {} };
  for (const r of others) {
    merged.visitors += r.visitors;
    for (const [k, n] of Object.entries(r.steps)) merged.steps[k] = (merged.steps[k] ?? 0) + n;
  }
  return [...rows.filter((r) => r.key !== "other"), merged].sort((a, b) => b.visitors - a.visitors);
}
