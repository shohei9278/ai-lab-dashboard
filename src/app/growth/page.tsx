import Link from "next/link";
import { getSettings } from "@/lib/db";
import { SNS_PLATFORMS, listGrowthPlans, type GrowthPlan } from "@/lib/growth";
import { PageIntro } from "@/components/PageIntro";
import { CopyButton } from "../reports/ReportActions";
import { CreatePlan, TaskCheck } from "./GrowthActions";
import { Trends } from "@/components/Trends";

export const dynamic = "force-dynamic";

const platformLabel = (p: string) => SNS_PLATFORMS[p as keyof typeof SNS_PLATFORMS] ?? p;

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const s = getSettings();
  const plans = listGrowthPlans();
  const row = plans.find((p) => p.id === Number(id)) ?? plans[0];
  const plan = row ? (JSON.parse(row.content) as GrowthPlan) : null;
  const done = new Set(row ? (JSON.parse(row.done) as number[]) : []);

  return (
    <div className="space-y-6">
      <PageIntro title="集客の作戦">
        フォロワーがほとんどいないアカウントで、どこから人を呼ぶかをAIが考えます。実行するのはあなたです（AIが投稿することはありません）。
        効果は、案件の画面の「SNSで広める」で投稿先ごとに作る専用リンクで測れます。週に1回ほど、済んだことにチェックを付けてから作り直すと、前回の結果をふまえた作戦になります。
        {s.snsAccount ? <> 対象のアカウント: <a href={`https://x.com/${s.snsAccount}`} target="_blank" rel="noreferrer" className="text-accent underline">@{s.snsAccount}</a></> : null}
      </PageIntro>

      <CreatePlan />

      <Trends />

      {plans.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="過去の作戦">
          {plans.map((p) => (
            <Link key={p.id} href={`/growth?id=${p.id}`} className={`num rounded-full border px-3 py-1 ${p.id === row?.id ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2"}`}>
              {p.created_at.slice(5, 10)}
            </Link>
          ))}
        </nav>
      )}

      {!plan || !row ? (
        <div className="card p-6 text-sm text-ink-2">まだ作戦がありません。上のボタンで作れます。</div>
      ) : (
        <>
          <section className="card space-y-2 p-4">
            <div className="text-xs text-muted">{row.created_at.slice(0, 16)} 作成</div>
            <p className="whitespace-pre-wrap">{plan.summary}</p>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card space-y-2 p-4">
              <h2 className="font-bold">今週やること</h2>
              <ul className="space-y-2">
                {plan.firstWeek.map((t, i) => (
                  <li key={i}>
                    <TaskCheck id={row.id} index={i} done={done.has(i)}>
                      {t.task}
                      <span className="ml-1 text-xs text-muted">（{platformLabel(t.platform)}{t.projectId ? `・#${t.projectId}` : ""}）</span>
                      {t.projectId ? <Link href={`/projects/${t.projectId}`} className="ml-1 text-xs text-accent underline">案件</Link> : null}
                    </TaskCheck>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card space-y-3 p-4">
              <h2 className="font-bold">プロフィールの案</h2>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs text-muted">プロフィール文<CopyButton text={plan.profile.bio} /></div>
                <p className="rounded-lg bg-surface-2 p-2 text-sm">{plan.profile.bio}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs text-muted">固定する投稿<CopyButton text={plan.profile.pinned} /></div>
                <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-sm">{plan.profile.pinned}</p>
              </div>
            </section>
          </div>

          <section className="space-y-2">
            <h2 className="font-bold">人を呼ぶ場所</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {plan.channels.map((c) => (
                <article key={c.name} className="card space-y-1.5 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold">{c.name}</h3>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{platformLabel(c.platform)}</span>
                    <span className="text-xs text-muted">手間: {c.effort}</span>
                    {c.projects.map((pid) => <Link key={pid} href={`/projects/${pid}`} className="text-xs text-accent underline">#{pid}</Link>)}
                  </div>
                  <p><span className="text-xs text-muted">どこで: </span>{c.where}</p>
                  <p><span className="text-xs text-muted">なぜ: </span>{c.why}</p>
                  <p><span className="text-xs text-muted">やり方: </span>{c.how}</p>
                  <p><span className="text-xs text-muted">気をつけること: </span>{c.risk}</p>
                  <p><span className="text-xs text-muted">測り方: </span>{c.measure}</p>
                </article>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card space-y-2 p-4">
              <h2 className="font-bold">届きやすい投稿の型</h2>
              <ul className="space-y-2 text-sm">
                {plan.postPatterns.map((x) => (
                  <li key={x.name}>
                    <div className="font-medium">{x.name}</div>
                    <p className="whitespace-pre-wrap text-ink-2">{x.example}</p>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card space-y-2 p-4">
              <h2 className="font-bold">やってはいけないこと</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm">{plan.avoid.map((x) => <li key={x}>{x}</li>)}</ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
