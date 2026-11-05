import Link from "next/link";
import { getSettings } from "@/lib/db";
import { listReports, type Report } from "@/lib/report";
import { NOTE_TOPICS } from "@/lib/notes";
import { PageIntro } from "@/components/PageIntro";
import { LabTabs } from "@/components/LabTabs";
import { AddNoteButton, CopyButton, CreateReportButton } from "./ReportActions";
import { jstFull } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const s = getSettings();
  const reports = listReports();
  const current = reports.find((r) => r.id === Number(id)) ?? reports[0];
  const r = current ? (JSON.parse(current.content) as Report) : null;

  return (
    <div className="space-y-6">
      <PageIntro title="レポート" actions={<CreateReportButton />}>
        1週間の数字と動きを、AIがまとめたものです。外に発信するための下書き（Xの投稿・記事）と、実験メモに残すとよい気づきも作ります。
        {s.weeklyReport ? "毎週月曜に自動で作ります。" : "自動で作るのは止めています（設定で変えられます）。"}
      </PageIntro>
      <LabTabs current="/reports" />

      {reports.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="過去のレポート">
          {reports.map((x) => (
            <Link key={x.id} href={`/reports?id=${x.id}`} className={`num rounded-full border px-3 py-1 ${x.id === current?.id ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2"}`}>
              {x.period_start.slice(5)}〜{x.period_end.slice(5)}
            </Link>
          ))}
        </nav>
      )}

      {!r || !current ? (
        <div className="card p-6 text-sm text-ink-2">まだレポートがありません。右上のボタンで、今すぐ作れます。</div>
      ) : (
        <>
          <section className="card space-y-3 p-4">
            <div className="text-xs text-muted">{current.period_start}〜{current.period_end}・{jstFull(current.created_at)} 作成</div>
            <p className="whitespace-pre-wrap">{r.summary}</p>
            {r.numbers.length > 0 && (
              <dl className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {r.numbers.map((n) => (
                  <div key={n.label} className="rounded-lg bg-surface-2 p-3">
                    <dt className="text-xs text-muted">{n.label}</dt>
                    <dd className="num font-bold">{n.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card space-y-2 p-4">
              <h2 className="font-bold">今週あったこと</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm">{r.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
              <h2 className="pt-2 font-bold">来週やるとよいこと</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm">{r.next.map((h) => <li key={h}>{h}</li>)}</ul>
            </section>
            <section className="card space-y-2 p-4">
              <h2 className="font-bold">実験メモに残すとよい気づき</h2>
              {r.noteIdeas.length === 0 ? <p className="text-sm text-ink-2">今週はありません。</p> : (
                <ul className="space-y-3">
                  {r.noteIdeas.map((n) => (
                    <li key={n.title} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{n.title}</span>
                        <span className="text-xs text-muted">{NOTE_TOPICS[n.topic as keyof typeof NOTE_TOPICS] ?? "その他"}</span>
                        <AddNoteButton title={n.title} body={n.body} topic={n.topic in NOTE_TOPICS ? n.topic : "other"} />
                      </div>
                      <p className="text-xs text-ink-2">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card space-y-2 p-4">
            <h2 className="font-bold">実験ログの下書き（あなたの個人アカウント用）</h2>
            <p className="text-xs text-muted">「AIにプロダクト作りを任せる実験」として、あなたが自分のアカウントで投稿する文です。「Xで投稿」を押すと、投稿の画面が開きます（送るのはあなたです）。</p>
            <ul className="space-y-2">
              {r.xPosts.map((x) => (
                <li key={x} className="flex items-start justify-between gap-3 rounded-lg bg-surface-2 p-3 text-sm">
                  <span className="whitespace-pre-wrap">{x}</span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <CopyButton text={x} />
                    <a href={`https://x.com/intent/post?text=${encodeURIComponent(x)}`} target="_blank" rel="noreferrer" className="text-xs text-accent underline">Xで投稿 ↗</a>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">記事の下書き（note など）</h2>
              <CopyButton text={r.article} label="Markdownをコピー" />
            </div>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm font-[inherit]">{r.article}</pre>
          </section>
        </>
      )}
    </div>
  );
}
