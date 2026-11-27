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

// アイデアの problem 欄の呼び名。ねらいで書く中身が違う（運営者の指摘: 遊びの案にも「困りごと」と出ていて、困りごとがあるように見えた）
// 広がる = その人のどんな気持ちに刺さるか、また来てもらう = 毎日来る動機、役に立つ・需要を確かめる（とねらいのない古い案件）= 困りごと
export function problemLabel(aim: unknown): string {
  if (aim === "spread") return "刺さる気持ち";
  if (aim === "return") return "毎日来る動機";
  return "困りごと";
}

// ジャンルの例（選びたいときだけ選ぶ。AIはこの中にないジャンルも出してよい）
// 「ガチャ・くじ」と「診断」は分けている（11/27 に運営者が決めた。ガチャ・くじにだけ、結果が出るまでの盛り上げる演出を付けるため。診断には付けない）
export const GACHA_GENRE = "ガチャ・くじ";
export const GENRES = [
  GACHA_GENRE, "診断", "あるある体験", "手ざわり", "なりきり・仕事体験", "反射・早押し", "作る・混ぜる",
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

// 推し枠: 平均では選ばれなかった案のうち、作者ではない会社のAIが CHAMPION_MIN 点以上を付けた案を1件選ぶ（運営者が決めた）
// 付けた点の高い順。同じなら、平均との差が大きい（評価が割れた・尖った）案、さらに同じなら平均点の高い案を先にする
// accept で外れた案（作ってよい件数の上限など）は飛ばす。当てはまる案がなければ null
export const CHAMPION_MIN = 8;
export function pickChampion<T extends { top: number | null; avg: number }>(rest: T[], accept: (x: T) => boolean = () => true): T | null {
  const list = rest
    .filter((x): x is T & { top: number } => x.top !== null && x.top >= CHAMPION_MIN)
    .sort((a, b) => b.top - a.top || (b.top - b.avg) - (a.top - a.avg) || b.avg - a.avg);
  for (const x of list) if (accept(x)) return x;
  return null;
}

// 推し枠つきで keep 件（2件以上）を選ぶ。keep - 1 件は今までどおり平均点で選び、最後の1件を推し枠にする
// 推し枠の候補からは、平均点なら最後の1件に選ばれる案を外す（今までと同じ案を推し枠と数えないように。PR #123 の ai-review の指摘）
// 推し枠の候補は、作ってよいねらい（allowed）で、平均点が下限（floor）以上の案だけ（今までの選ぶ決まりを通す。PR #123 の ai-review の指摘）
// ねらいの配分（足りないねらいを先にする並べ替え）は当てない（推し枠は、わざと平均点の順から外して選ぶ枠のため。運営者が決めた）
// peek: accept と同じ条件を、件数を減らさずに確かめる。推し枠に当てはまる案がなければ、平均点の案を選ぶ
export function pickWithChampion<T extends { aim: Aim; avg: number; author: string; top: number | null }>(
  list: T[], keep: number, weights: AimWeights, counts: Partial<Record<Aim, number>>, allowed: readonly Aim[], floor: number,
  accept: (x: T) => boolean, peek: (x: T) => boolean,
): { picked: T[]; champion: T | null } {
  if (keep < 2) return { picked: pickByAims(list, keep, weights, counts, allowed, floor, accept), champion: null };
  const base = pickByAims(list, keep - 1, weights, counts, allowed, floor, accept);
  const rest = list.filter((x) => !base.includes(x));
  const n = { ...counts };
  for (const b of base) n[b.aim] = (n[b.aim] ?? 0) + 1;
  const next = pickByAims(rest, 1, weights, n, allowed, floor, peek)[0];
  const champion = pickChampion(rest.filter((x) => x !== next && allowed.includes(x.aim) && x.avg >= floor), accept);
  if (champion) return { picked: [...base, champion], champion };
  return { picked: [...base, ...pickByAims(rest, 1, weights, n, allowed, floor, accept)], champion: null };
}

// AIの答えのねらいを、頼んだねらいとそろえる
// 頼んだねらい（aims）があるときは、ねらいごとに頼んだ件数までの案だけを残す（順番の入れ替えはよい。頼んでいないねらいや、件数を超えた分は外す。
// 名前だけ書き換えると中身とねらいが食い違うので、外す）。書かれていなければ、書かれた案が使った分を除いて、残っているねらいを頼んだ順に当てる
// 頼んでいないときは、書かれたねらい（なければ形から）。どちらも、形（kind）はねらいに合わせ、ジャンルは30文字まで
export function alignIdeaAims<T extends { aim?: unknown; kind?: unknown; genre?: unknown }>(ideas: T[], aims: readonly Aim[] = []): {
  ideas: (T & { aim: Aim; kind: "lp" | "tool"; genre: string | undefined })[]; dropped: { idea: T; aim: Aim }[];
} {
  // ねらいごとの、まだ受け付けられる件数
  const left = new Map<Aim, number>();
  for (const a of aims) left.set(a, (left.get(a) ?? 0) + 1);
  const take = (a: Aim) => {
    if (!left.get(a)) return false;
    left.set(a, left.get(a)! - 1);
    return true;
  };
  // 1回目: ねらいが書かれた案で件数を使う。2回目: 書かれていない案に、残っているねらいを頼んだ順に当てる（順番が入れ替わっていても、書かれた案の分を先に引く）
  const decided = new Map<number, { aim: Aim; ok: boolean }>();
  ideas.forEach((idea, i) => {
    if (!isAim(idea.aim)) return;
    decided.set(i, { aim: idea.aim, ok: !aims.length || take(idea.aim) });
  });
  ideas.forEach((idea, i) => {
    if (decided.has(i)) return;
    if (!aims.length) return decided.set(i, { aim: aimOfIdea(idea), ok: true });
    const next = aims.find((a) => (left.get(a) ?? 0) > 0);
    decided.set(i, next ? { aim: next, ok: take(next) } : { aim: aimOfIdea(idea), ok: false });
  });
  const out: (T & { aim: Aim; kind: "lp" | "tool"; genre: string | undefined })[] = [];
  const dropped: { idea: T; aim: Aim }[] = [];
  ideas.forEach((idea, i) => {
    const { aim, ok } = decided.get(i)!;
    if (!ok) dropped.push({ idea, aim });
    else out.push({ ...idea, aim, kind: AIMS[aim].kind, genre: typeof idea.genre === "string" && idea.genre.trim() ? idea.genre.trim().slice(0, 30) : undefined });
  });
  return { ideas: out, dropped };
}

// アイデアのねらいを、形とそろえて決める（書かれていない・形と合わないときは、形から決める）
export function aimOfIdea(idea: { aim?: unknown; kind?: unknown }): Aim {
  const kind = idea.kind === "tool" ? "tool" : "lp";
  if (isAim(idea.aim) && AIMS[idea.aim].kind === kind) return idea.aim;
  return kind === "lp" ? "demand" : "useful";
}

// 案件のジャンルが「ガチャ・くじ」か。AIはジャンルを自由な言葉で書くので、ガチャ・くじを含むものを数える
// 分ける前の「ガチャ・診断」は、診断の遊びかもしれないので数えない（診断に演出を付けないため）
export function isGachaGenre(genre: string | null | undefined): boolean {
  return typeof genre === "string" && /ガチャ|くじ/.test(genre) && !/診断/.test(genre);
}

// 手のアイデア出しで、その回だけ選んだジャンル（11/27 に運営者が決めた）。ジャンルの一覧にあるものだけを受け付ける（自由な言葉は AI への指示に入れない）
export function genreOnceOf(v: unknown): string | undefined {
  return typeof v === "string" && (GENRES as readonly string[]).includes(v) ? v : undefined;
}

// アイデア出しで使うジャンル: その回だけ選んだものがあればそれ、なければ設定の画面のジャンル（設定は変えない）
export function ideaGenresFor(settingGenres: string, genreOnce?: string): string[] {
  return genreOnce ? [genreOnce] : genresOf(settingGenres);
}

// 設定のジャンル（カンマ区切り）を一覧にする（空ならおまかせ）
export function genresOf(text: string): string[] {
  return [...new Set(text.split(/[,、\n]/).map((x) => x.trim()).filter((x) => x && x.length <= 30))].slice(0, 20);
}

// 宣伝先の配分で使う、案件の型（遊ぶツール／役立つツール／事前登録LP）
// 広がる・また来てもらう のツールは「遊ぶツール」、役に立つ は「役立つツール」、需要を確かめる（紹介ページ）は「事前登録LP」
// ねらいの付いていない古いツールは、どちらとも決められないので分けて数える
export type ProjectType = "play" | "useful" | "lp" | "tool";
export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = { play: "遊ぶツール", useful: "役立つツール", lp: "事前登録LP", tool: "ツール（ねらいなし）" };
export function projectType(p: { kind: string; aim: string | null }): ProjectType {
  if (p.kind !== "tool") return "lp";
  if (p.aim === "useful") return "useful";
  if (p.aim === "spread" || p.aim === "return") return "play";
  return "tool";
}
