import type { Metadata } from "next";
import Link from "next/link";
import { getLp } from "@/lib/supabase";
import { SITE_NAME } from "@/lib/site";
import { ToolSection } from "../../[slug]/ToolSection";
import { allocate, GUIDE_BUDGETS, GUIDE_PEOPLE, GUIDE_TOOL_SLUG, PRIZE_WEIGHTS, yen } from "@/lp/bingoGuide";

// 検索で見つかる解説ページ（提案箱 #60）。幹事が検索する言葉（ビンゴ 景品 予算 配分）に答える
// 人数別・予算別の配分表を先に見せ、その下に案件 #40 の電卓（公開中のツール本体）を置く。電卓が読めないときは表と説明だけを出す
// 訪問は GA のページの表示（このページのパス）で数える。ツールを使ったら、案件 #40 の「使った」として数える
export const dynamic = "force-dynamic";

const PATH = "/guide/bingo-prize-budget";
const TITLE = "ビンゴの景品の予算配分の目安｜10・20・30人、3万・5万円の早見表";
const DESCRIPTION = "忘年会・社内イベントのビンゴの景品を、予算と人数から何等にいくら・何個にするかの目安を表にしました。人数10・20・30人、予算3万・5万円の配分表と、自分の条件で計算できる無料の電卓があります。";

export const metadata: Metadata = {
  title: `${TITLE}｜${SITE_NAME}`,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: SITE_NAME, type: "article", locale: "ja_JP", url: PATH },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

const FAQ = [
  { q: "景品は何個用意すればいいですか？", a: "全員に何か当たるようにするなら、参加人数と同じ数です。この表では、1等1個、2等は人数の1割、3等は2割、残りの全員に参加賞としています。参加賞をなくすと、上の等に予算を回せます。" },
  { q: "1等にはいくらかければいいですか？", a: "この表の目安では、1等1個に参加賞8個分の金額をかけています。人数が少ないほど1等に回る金額が大きくなり、人数が多いと参加賞の数が増えるぶん小さくなります。" },
  { q: "予算が余ったら？", a: "金額は100円単位で切り捨てているので、少し余ります。送料や包装、当日の予備に回すと安心です。" },
];

function Table({ people, budget }: { people: number; budget: number }) {
  const a = allocate(people, budget);
  return (
    <figure className="overflow-x-auto rounded-xl border border-line">
      <figcaption className="bg-surface-2 px-3 py-2 sm:px-4 text-sm font-bold">{people}人・予算{yen(budget)}</figcaption>
      <table className="w-full whitespace-nowrap text-sm">
        <thead>
          <tr className="text-left text-ink-2">
            <th scope="col" className="px-3 py-2 sm:px-4 font-medium">等</th>
            <th scope="col" className="px-3 py-2 sm:px-4 text-right font-medium">1個あたり</th>
            <th scope="col" className="px-3 py-2 sm:px-4 text-right font-medium">個数</th>
            <th scope="col" className="px-3 py-2 sm:px-4 text-right font-medium">小計</th>
          </tr>
        </thead>
        <tbody>
          {a.rows.map((r) => (
            <tr key={r.tier} className="border-t border-line">
              <th scope="row" className="px-3 py-2 sm:px-4 text-left font-medium">{r.label}</th>
              <td className="px-3 py-2 sm:px-4 text-right tabular-nums">{yen(r.unit)}</td>
              <td className="px-3 py-2 sm:px-4 text-right tabular-nums">{r.count}個</td>
              <td className="px-3 py-2 sm:px-4 text-right tabular-nums">{yen(r.subtotal)}</td>
            </tr>
          ))}
          <tr className="border-t border-line text-ink-2">
            <th scope="row" className="px-3 py-2 sm:px-4 text-left font-medium">予備（余り）</th>
            <td colSpan={3} className="px-3 py-2 sm:px-4 text-right tabular-nums">{yen(a.spare)}</td>
          </tr>
        </tbody>
      </table>
    </figure>
  );
}

export default async function BingoPrizeBudgetGuide() {
  // 電卓（案件 #40 のツール）。公開を止めた・読めないときは出さない
  const lp = await getLp(GUIDE_TOOL_SLUG).catch(() => null);
  const tool = lp && lp.status === "published" ? lp.content.tool : undefined;
  const w = PRIZE_WEIGHTS;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 leading-relaxed">
      <p className="text-sm"><Link href="/" className="underline">{SITE_NAME}</Link></p>
      <h1 className="mt-4 text-2xl font-bold">ビンゴの景品、予算をどう配分する？ 人数・予算別の早見表</h1>
      <p className="mt-4 text-ink-2">
        忘年会や社内イベントのビンゴで、景品の予算と人数は決まっているのに、「1等にいくら」「何等まで作るか」で迷ったときの目安です。
        よくある人数（10・20・30人）と予算（3万・5万円）の配分を、先に表で見せます。
        {lp && tool && <>自分の条件で計算したいときは、<a href="#calc" className="underline">下の電卓</a>を使ってください。</>}
      </p>

      <section className="mt-8 rounded-xl bg-surface-2 p-4 text-sm">
        <h2 className="font-bold">この表の決め方</h2>
        <ul className="ml-5 mt-2 list-disc space-y-1">
          <li>全員に何か当たる形です。1等は1個、2等は人数の1割、3等は2割、残りの全員に参加賞。</li>
          <li>1個あたりの金額の比を、1等:2等:3等:参加賞 = {w.first}:{w.second}:{w.third}:{w.all} にして、予算を割っています。</li>
          <li>金額は100円単位で切り捨て、余りは予備にしています。これは目安の一例で、決まりではありません。</li>
        </ul>
      </section>

      {GUIDE_BUDGETS.map((budget) => (
        <section key={budget} className="mt-10">
          <h2 className="text-xl font-bold">予算{yen(budget)}の配分</h2>
          <div className="mt-4 grid gap-4">
            {GUIDE_PEOPLE.map((people) => <Table key={people} people={people} budget={budget} />)}
          </div>
        </section>
      ))}

      <section className="mt-10">
        <h2 className="text-xl font-bold">配分を決める3つの手順</h2>
        <ol className="ml-5 mt-3 list-decimal space-y-2">
          <li>景品を何人に当てるかを決める（全員か、一部の人だけか）。</li>
          <li>1等を目玉にするか、全体を均等にするか（配分の傾き）を決める。</li>
          <li>等ごとの金額が決まったら、その価格帯で景品を選び、予算に収まるかを確かめる。</li>
        </ol>
      </section>

      {lp && tool && (
        <section id="calc" className="mt-12">
          <h2 className="text-xl font-bold">自分の予算と人数で計算する（無料・登録不要）</h2>
          <p className="mt-2 text-sm text-ink-2">総予算・参加人数・当てる人数・配分の傾きを入れると、等ごとの金額と個数を割り振ります。</p>
          <div className="mt-4">
            <ToolSection slug={lp.slug} version={lp.version} html={tool.html} title={lp.title} data={tool.data} fonts={tool.fonts} illustration={lp.content.design?.illustration?.url} images={tool.images} ai={!!tool.ai} />
          </div>
          <p className="mt-3 text-sm"><Link href={`/${lp.slug}`} className="underline">{lp.title}のページを開く</Link></p>
        </section>
      )}

      <section className="mt-12">
        <h2 className="text-xl font-bold">よくある質問</h2>
        <dl className="mt-3 space-y-4">
          {FAQ.map((f) => (
            <div key={f.q}>
              <dt className="font-bold">{f.q}</dt>
              <dd className="mt-1 text-ink-2">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
