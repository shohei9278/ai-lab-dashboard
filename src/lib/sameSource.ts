// 同じ元の声（Xの「欲しい」の投稿。user_wants）から出た案どうしを、審査の前に並べて比べる（提案箱 #55）
// 同じ投稿が元で中身も重なる案を両方作ると、検証の訪問者や運営者の手間が分かれるため、
// 違い（機能・届け先）を1行で並べて審査するAIに見せ、「1つに絞る（one）」か「作り分ける（both）」かを答えてもらう

export type SameSourceChoice = "one" | "both";

export type SameSourceItem = { label: string; wantId: number | null; title: string; solution: string; target: string; channel?: string };

const cut = (s: string | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// 同じ声から2件以上出た組だけを、声の番号の順に返す（声の番号がない案は数えない）
export function sameSourceGroups<T extends { wantId: number | null }>(items: T[]): { wantId: number; items: T[] }[] {
  const by = new Map<number, T[]>();
  for (const x of items) {
    if (x.wantId === null) continue;
    by.set(x.wantId, [...(by.get(x.wantId) ?? []), x]);
  }
  return [...by.entries()].filter(([, xs]) => xs.length >= 2).sort((a, b) => a[0] - b[0]).map(([wantId, xs]) => ({ wantId, items: xs }));
}

// 組ごとの違いを1行で（機能 = 解決策、届け先 = 対象と最初の届け方）
export function sameSourceLine(g: { wantId: number; items: SameSourceItem[] }): string {
  return `声${g.wantId}から${g.items.length}件: ${g.items
    .map((x) => `【${x.label}】「${cut(x.title, 30)}」機能: ${cut(x.solution, 60)}／届け先: ${cut(x.target, 30)}${x.channel ? `・${cut(x.channel, 40)}` : ""}`)
    .join(" ｜ ")}`;
}

// 審査するAIの答え（same_source）から、声の番号ごとの答えを取り出す。形の違うもの・組にない声は捨てる
export function parseSameSource(v: unknown, wantIds: number[]): Map<number, SameSourceChoice> {
  const out = new Map<number, SameSourceChoice>();
  if (!Array.isArray(v)) return out;
  for (const x of v) {
    if (typeof x !== "object" || x === null) continue;
    const r = x as Record<string, unknown>;
    const id = typeof r.voice === "number" ? r.voice : typeof r.voice === "string" ? Number(r.voice.replace(/^声/, "")) : NaN;
    if (!wantIds.includes(id) || out.has(id)) continue;
    if (r.choice === "one" || r.choice === "both") out.set(id, r.choice);
  }
  return out;
}

// 作り分けるのは、答えた社の過半数が「作り分ける」と答えたときだけ。同数・答えがないときは1つに絞る（手間を分けないほうを先にする）
export function decideSameSource(votes: SameSourceChoice[]): SameSourceChoice {
  const both = votes.filter((v) => v === "both").length;
  return both * 2 > votes.length ? "both" : "one";
}
