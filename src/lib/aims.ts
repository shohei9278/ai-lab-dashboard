// 案件の「ねらい」と「ジャンル」
// ねらいは、何をもって当たりとするか（物差し）を決める。形（kind）はねらいから決まる（需要を確かめる = 事前登録LP、ほか = 動くツール）
// 検索で見つけてもらう・稼ぐ は、人の作業（Search Console・決済など）が済んでから足す

export const AIMS = {
  spread: { label: "広がる", kind: "tool", short: "遊び・ネタ・結果の見せ合いで、見た人が触ってシェアし、フォロワーが増える" },
  useful: { label: "役に立つ", kind: "tool", short: "困りごとを今すぐ解決する道具として使われる" },
  return: { label: "また来てもらう", kind: "tool", short: "毎日変わる理由があり、何日かあとにまた来てもらえる" },
  demand: { label: "需要を確かめる", kind: "lp", short: "まだ作らずに、紹介ページの事前登録で需要を確かめる" },
} as const;
export type Aim = keyof typeof AIMS;
export const AIM_KEYS = Object.keys(AIMS) as Aim[];
export const isAim = (v: unknown): v is Aim => typeof v === "string" && Object.hasOwn(AIMS, v);

// ジャンルの例（選びたいときだけ選ぶ。AIはこの中にないジャンルも出してよい）
export const GENRES = [
  "ガチャ・診断", "あるある体験", "手ざわり", "なりきり・仕事体験", "反射・早押し", "作る・混ぜる",
  "物理おもちゃ", "言葉遊び", "クイズ", "見て楽しむ（図解・データ）", "音・絵のおもちゃ", "計算・変換",
] as const;

export type AimWeights = Record<Aim, number>;
export const aimWeightsOf = (s: { aimSpread: number; aimUseful: number; aimReturn: number; aimDemand: number }): AimWeights =>
  ({ spread: s.aimSpread, useful: s.aimUseful, return: s.aimReturn, demand: s.aimDemand });

// 配分（重み）どおりに total 個の枠へねらいを割り振る（端数は大きい順。重みのあるねらいは、枠が足りる限り1つは入れる）
// allowed で使えるねらいを絞る（じっくり案件はツールだけ、など）。重みが全部0なら、使えるねらいを同じ重みで扱う
export function allocateAims(total: number, weights: AimWeights, allowed: readonly Aim[] = AIM_KEYS): Aim[] {
  if (total <= 0 || !allowed.length) return [];
  const w = allowed.map((a) => ({ a, w: Math.max(0, weights[a] ?? 0) }));
  if (w.every((x) => x.w === 0)) w.forEach((x) => (x.w = 1));
  const sum = w.reduce((t, x) => t + x.w, 0);
  const rows = w.map((x) => ({ ...x, exact: (x.w / sum) * total, n: Math.floor((x.w / sum) * total) }));
  let left = total - rows.reduce((t, r) => t + r.n, 0);
  for (const r of [...rows].sort((p, q) => q.exact - q.n - (p.exact - p.n) || q.w - p.w)) {
    if (left <= 0) break;
    r.n++;
    left--;
  }
  // 重みのあるねらいが0枠なら、いちばん多いねらいから1つ回す（枠がねらいの数より少ないときは回さない）
  const positive = rows.filter((r) => r.w > 0);
  if (total >= positive.length) {
    for (const r of positive.filter((x) => x.n === 0)) {
      const most = [...rows].sort((p, q) => q.n - p.n || p.w - q.w)[0];
      if (most.n <= 1) break;
      most.n--;
      r.n++;
    }
  }
  // 重みの大きい順に並べる（2社以上に配るときに、同じねらいが1社に偏らないよう、呼び出し側で交互に配る）
  return [...rows].sort((p, q) => q.w - p.w).flatMap((r) => Array<Aim>(r.n).fill(r.a));
}

// 枠を、各社に交互に配る（[広がる, 広がる, 役に立つ, …] を、1社目・2社目・3社目・1社目…の順に）
export function dealAims(aims: Aim[], authors: number): Aim[][] {
  const out: Aim[][] = Array.from({ length: authors }, () => []);
  aims.forEach((a, i) => out[i % authors].push(a));
  return out;
}

// 次に案件にするねらい: 配分に比べて、最近の案件でいちばん足りていないもの（同じなら重みの大きいもの）
// counts は、最近の案件と、今回すでに残した案のねらいごとの数
export function aimsByDeficit(weights: AimWeights, counts: Partial<Record<Aim, number>>, allowed: readonly Aim[] = AIM_KEYS): Aim[] {
  const usable = allowed.filter((a) => (weights[a] ?? 0) > 0);
  const list = usable.length ? usable : [...allowed];
  const sum = list.reduce((t, a) => t + Math.max(0, weights[a] ?? 0), 0) || list.length;
  const n = list.reduce((t, a) => t + (counts[a] ?? 0), 0);
  const share = (a: Aim) => (usable.length ? Math.max(0, weights[a]) / sum : 1 / list.length);
  return [...list].sort((p, q) => share(q) * (n + 1) - (counts[q] ?? 0) - (share(p) * (n + 1) - (counts[p] ?? 0)) || (weights[q] ?? 0) - (weights[p] ?? 0));
}

// 採点した案から、keep 件を案件にする
// 枠ごとに、配分に比べていちばん足りないねらいから、そのねらいで点のいちばん高い案を選ぶ（点が floor 未満の案しかなければ、次に足りないねらいへ。
// どのねらいにもなければ、ねらいに関係なく点の高い順）。同じ点なら、まだ選んでいない作者の案を先にする
// accept が false を返した案（じっくり案件の上限など）は、案件にせずに次へ。counts は最近の案件の数（選んだ分を足していく）
export function pickByAims<T extends { aim: Aim; avg: number; author: string }>(
  list: T[], keep: number, weights: AimWeights, counts: Partial<Record<Aim, number>>, allowed: readonly Aim[], floor: number, accept: (x: T) => boolean = () => true,
): T[] {
  const kept: T[] = [];
  const n = { ...counts };
  const rest = [...list].sort((a, b) => b.avg - a.avg);
  const bestOf = (xs: T[]) => {
    const top = xs[0].avg;
    const tied = xs.filter((x) => Math.abs(x.avg - top) < 1e-9);
    return tied.find((x) => !kept.some((k) => k.author === x.author)) ?? tied[0];
  };
  while (kept.length < keep && rest.length) {
    let pick: T | undefined;
    for (const aim of aimsByDeficit(weights, n, allowed)) {
      const of = rest.filter((x) => x.aim === aim && x.avg >= floor);
      if (of.length) {
        pick = bestOf(of);
        break;
      }
    }
    pick ??= bestOf(rest);
    rest.splice(rest.indexOf(pick), 1);
    if (!accept(pick)) continue;
    kept.push(pick);
    n[pick.aim] = (n[pick.aim] ?? 0) + 1;
  }
  return kept;
}

// アイデアのねらいを、形とそろえて決める（書かれていない・形と合わないときは、形から決める）
export function aimOfIdea(idea: { aim?: unknown; kind?: unknown }): Aim {
  const kind = idea.kind === "tool" ? "tool" : "lp";
  if (isAim(idea.aim) && AIMS[idea.aim].kind === kind) return idea.aim;
  return kind === "lp" ? "demand" : "useful";
}

// 設定のジャンル（カンマ区切り）を一覧にする（空ならおまかせ）
export function genresOf(text: string): string[] {
  return [...new Set(text.split(/[,、\n]/).map((x) => x.trim()).filter((x) => x && x.length <= 30))].slice(0, 20);
}
