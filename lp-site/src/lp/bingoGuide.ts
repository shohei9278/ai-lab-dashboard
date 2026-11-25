// 検索で見つかる解説ページ（/guide/bingo-prize-budget）の配分表の計算（提案箱 #60）
// 画面のコードに入れず、ここで計算する（テストで確かめる）
// 決まった目安の一例: 1等・2等・3等・参加賞の1個あたりの重みを 8:4:2:1 にして、予算を割る。金額は100円単位で切り捨て、余りは予備にする

export const GUIDE_TOOL_SLUG = "p40"; // 提案箱 #60 の対象。案件 #40「ビンゴ景品わりふり電卓」
export const GUIDE_PEOPLE = [10, 20, 30] as const;
export const GUIDE_BUDGETS = [30_000, 50_000] as const;

export const PRIZE_WEIGHTS = { first: 8, second: 4, third: 2, all: 1 } as const;
type Tier = keyof typeof PRIZE_WEIGHTS;
export const TIER_LABELS: Record<Tier, string> = { first: "1等", second: "2等", third: "3等", all: "参加賞" };

export type Row = { tier: Tier; label: string; count: number; unit: number; subtotal: number };
export type Allocation = { people: number; budget: number; rows: Row[]; spare: number };

// 個数: 1等は1個、2等は人数の1割（最低1個）、3等は2割、残りの全員に参加賞（全員に何かが当たる）
export function tierCounts(people: number): Record<Tier, number> {
  const first = 1;
  const second = Math.max(1, Math.round(people * 0.1));
  const third = Math.max(1, Math.round(people * 0.2));
  return { first, second, third, all: Math.max(0, people - first - second - third) };
}

export function allocate(people: number, budget: number): Allocation {
  const counts = tierCounts(people);
  const tiers = Object.keys(PRIZE_WEIGHTS) as Tier[];
  const units = tiers.reduce((s, t) => s + counts[t] * PRIZE_WEIGHTS[t], 0);
  const rows = tiers.filter((t) => counts[t] > 0).map((t) => {
    const unit = Math.floor((budget * PRIZE_WEIGHTS[t]) / units / 100) * 100;
    return { tier: t, label: TIER_LABELS[t], count: counts[t], unit, subtotal: unit * counts[t] };
  });
  const used = rows.reduce((s, r) => s + r.subtotal, 0);
  return { people, budget, rows, spare: budget - used };
}

export const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
