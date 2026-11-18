import { db, getSettings } from "./db";

// 人の作業待ち: 作るのに、今はまだない仕組み（保存の場所・外部のAPI・その場でAIを呼ぶ など）や、人が用意するもの（素材など）が要るじっくり案件
// アイデアに「要るもの（needs）」を書かせ、選ばれたら案件にして、作り始める前に止める。人が用意したら（仕組みを作ったら）「済み」にして作り始める
// 何が要る案件が、どれだけ溜まっているかが、次にどの仕組みを作るかを決める材料になる

// ready: その仕組みが今あるか（人が用意すれば、ツールから使えるか）。保存の場所・API・AI はまだないので、「済み」にできない
// 仕組みを作るときに、ツールを作るときの決まり（toolRules・staticToolIssues）も一緒に変えて、ここを true にする
export const NEED_KINDS = {
  store: { label: "保存の場所", hint: "みんなの投票・ランキング・みんなの結果など、訪問者が入れたものを保存して、ほかの人に見せる", ready: false },
  api: { label: "外部のAPI", hint: "天気・地図・翻訳など、外のサービスのデータや機能を呼ぶ", ready: false },
  ai: { label: "その場でAIを呼ぶ", hint: "訪問者の入力に、AIがその場で答える・名前を付ける・絵を描く", ready: false },
  asset: { label: "素材", hint: "画像・音・フォントなど、人が用意する素材", ready: true },
  other: { label: "そのほか", hint: "上にない、人の作業や仕組み", ready: true },
} as const;
// まだない仕組み（作るまで「済み」にできない）
export const notReady = (needs: Need[]) => needs.filter((n) => !NEED_KINDS[n.kind].ready);
export type NeedKind = keyof typeof NEED_KINDS;
export type Need = { kind: NeedKind; what: string; why: string };
export const isNeedKind = (v: unknown): v is NeedKind => typeof v === "string" && Object.hasOwn(NEED_KINDS, v);

// アイデアに書かれた要るものを、決めた形にそろえる（3つまで。種類が違う・中身がないものは外す）
export function needsOf(v: unknown): Need[] {
  if (!Array.isArray(v)) return [];
  const out: Need[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (!isNeedKind(o.kind) || typeof o.what !== "string" || !o.what.trim()) continue;
    out.push({ kind: o.kind, what: o.what.trim().slice(0, 100), why: typeof o.why === "string" ? o.why.trim().slice(0, 160) : "" });
    if (out.length >= 3) break;
  }
  return out;
}

// 人の作業待ちの案件（作り始める前に止めているもの）の条件（SQL）。案件の表を p として使う
export const NEEDS_WAIT_SQL = "p.needs IS NOT NULL AND p.needs_done = 0 AND p.stage = 'idea'";

// 人の作業待ちの案件の数
export function needsWaiting(): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM projects p WHERE p.demo = 0 AND ${NEEDS_WAIT_SQL}`).get() as { n: number }).n;
}

// 長く手が付いていない人の作業待ち（見送りの候補として知らせる）の日数
export const NEEDS_STALE_DAYS = 30;

export type NeedsProject = { id: number; title: string; needs: Need[]; createdAt: string; days: number; demo: boolean };
export type NeedsGroup = { kind: NeedKind; label: string; hint: string; projects: { id: number; title: string; what: string; why: string; days: number }[] };

// 人の作業待ちの案件の一覧（古い順）
export function needsProjects(): NeedsProject[] {
  const rows = db().prepare(`SELECT p.id, p.title, p.needs, p.created_at, p.demo FROM projects p WHERE ${NEEDS_WAIT_SQL} ORDER BY p.id`).all() as { id: number; title: string; needs: string; created_at: string; demo: number }[];
  return rows.map((r) => ({
    id: r.id, title: r.title, needs: needsOf(JSON.parse(r.needs)), createdAt: r.created_at, demo: !!r.demo,
    days: Math.floor((Date.now() - Date.parse(r.created_at.replace(" ", "T") + "Z")) / 86_400_000),
  }));
}

// 要るものの種類ごとにまとめる（「これを作れば、この3件が動く」が見えるように。件数の多い順）
export function needsGroups(list: NeedsProject[] = needsProjects()): NeedsGroup[] {
  const map = new Map<NeedKind, NeedsGroup>();
  for (const p of list) {
    for (const n of p.needs) {
      const g = map.get(n.kind) ?? { kind: n.kind, label: NEED_KINDS[n.kind].label, hint: NEED_KINDS[n.kind].hint, projects: [] };
      g.projects.push({ id: p.id, title: p.title, what: n.what, why: n.why, days: p.days });
      map.set(n.kind, g);
    }
  }
  return [...map.values()].sort((a, b) => b.projects.length - a.projects.length);
}

export const needsWaitMax = () => getSettings().needsWaitMax;
