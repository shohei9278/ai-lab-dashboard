import Link from 'next/link'
import { ShowMore } from '@/components/ShowMore'
import { PageIntro } from '@/components/PageIntro'
import { isOwner } from '@/lib/viewer'
import { adhocRunning } from '@/lib/adhoc'
import { members } from '@/lib/weekly'
import { MeetingForm } from './MeetingForm'
import { jstDateTime } from '@/lib/format'
import { modelInfo } from '@/lib/models'
import { MEETING_LABEL, listMeetings, type FollowUp, type Meeting, type MeetingKind } from '@/lib/meetings'

export const dynamic = 'force-dynamic'

function Who({ id }: { id: string | null }) {
  if (!id) return <span className="text-muted">作者は伏せ中</span>
  const m = modelInfo(id)
  return <span style={{ color: `var(--series-${m.provider})` }}>{m.label}</span>
}

const HAPPENED: Record<string, { label: string; color: string }> = {
  yes: { label: '少数派の心配が当たった', color: 'var(--warning)' },
  no: { label: '少数派の心配は当たらなかった', color: 'var(--good)' },
  unclear: { label: 'まだ分からない（数字が足りない）', color: 'var(--muted)' },
}

// 意見が割れたところと、その後（少数派が心配したことが、実際に起きたか）
function FollowUpBox({ f }: { f: FollowUp }) {
  const per = (x: { days: number; visits: number }) => (x.days ? (x.visits / x.days).toFixed(1) : '—')
  return (
    <div className="space-y-2 rounded-lg p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
      <div className="font-medium">意見が割れたところ</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <span className="text-xs text-muted">多数派</span>
          <p>{f.split.majority}</p>
        </div>
        <div>
          <span className="text-xs text-muted">少数派{f.split.minorityBy.length ? `（${f.split.minorityBy.join('・')}）` : ''}</span>
          <p>{f.split.minority}</p>
        </div>
      </div>
      <p>
        <span className="text-xs text-muted">少数派の心配: </span>
        {f.split.concern}
      </p>
      {f.split.watch && <p className="text-xs text-ink-2">確かめ方: {f.split.watch}</p>}
      <div className="border-t border-line pt-2">
        <div className="text-xs text-muted">{f.due ? `その後（${f.dueAt}に振り返り）` : `その後（${f.dueAt}に振り返ります。今は途中経過）`}</div>
        <p className="num text-sm">
          1日あたりの訪問: 会議の前7日 {per(f.before)}人 → 会議のあと{f.after.days}日 {per(f.after)}人 ・登録/利用: 前 {f.before.conversions}人 → あと {f.after.conversions}人
        </p>
        {f.actions.length > 0 && <p className="text-xs text-ink-2">会議で決めたこと: {f.actions.map((a) => `「${a.title}」${a.status}`).join('・')}</p>}
        {f.revisit && (
          <p className="mt-1">
            <b style={{ color: HAPPENED[f.revisit.happened]?.color }}>{HAPPENED[f.revisit.happened]?.label}</b>
            <span className="text-ink-2">　{f.revisit.note}</span>
            <span className="ml-1 text-xs text-muted">（{modelInfo(f.revisit.by).label}が定例会議で確認）</span>
          </p>
        )}
      </div>
    </div>
  )
}

function MeetingCard({ m }: { m: Meeting }) {
  return (
    <article id={m.key} className="card scroll-mt-4 space-y-2 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded bg-surface-2 px-1.5 text-xs">{MEETING_LABEL[m.kind]}</span>
        <h2 className="font-bold">
          {m.projectId ? (
            <Link href={`/projects/${m.projectId}`} className="hover:underline">
              {m.title}
            </Link>
          ) : (
            m.title
          )}
        </h2>
        <span className="num ml-auto text-xs text-muted">{jstDateTime(m.at)}</span>
      </div>
      <div className="flex flex-wrap gap-x-2 text-xs text-ink-2">
        出席:{' '}
        {m.attendees.length ? (
          m.attendees.map((a, i) => (
            <span key={a}>
              {i > 0 && '・'}
              <Who id={a} />
            </span>
          ))
        ) : (
          <span className="text-muted">（作者を伏せて採点中）</span>
        )}
      </div>
      <p className="text-sm">
        <span className="text-muted">結論: </span>
        {m.conclusion}
      </p>
      {m.followUp && <FollowUpBox f={m.followUp} />}
      {m.items.length > 0 && (
        <details className="border-t border-line pt-2">
          <summary className="cursor-pointer text-sm text-ink-2">発言と採点を見る（{m.items.length}件）</summary>
          <ul className="mt-2 space-y-2">
            {m.items.map((it, i) => (
              <li key={i} className="rounded-lg border p-2 text-sm" style={{ borderColor: it.won ? 'var(--accent)' : 'var(--line)' }}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Who id={it.who} />
                  <span className="font-medium">{it.title}</span>
                  {it.score != null && <span className="num text-xs text-ink-2">平均 {it.score.toFixed(1)}点</span>}
                  {it.won && <span className="text-xs text-accent">採用</span>}
                </div>
                {it.text && <p className="mt-1 whitespace-pre-wrap text-ink-2">{it.text}</p>}
                {it.scores && it.scores.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                    {it.scores.map((s, j) => (
                      <li key={j}>
                        <Who id={s.who} /> <span className="num">{s.score}点</span>
                        {s.reason ? `: ${s.reason}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}

// 会議室: AIの社員どうしのやり取りの議事録（直近30日）
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams
  const owner = await isOwner()
  const people = members().map((id) => ({ id, label: modelInfo(id).label, color: `var(--series-${modelInfo(id).provider})` }))
  const k = kind && kind in MEETING_LABEL ? (kind as MeetingKind) : undefined
  const list = listMeetings(k)
  console.log(list)
  return (
    <div className="space-y-6">
      <PageIntro title="会議室">AIの社員（Claude・GPT・Gemini）どうしのやり取りの記録です。案を出し合い、だれの案かを伏せて採点し合い、点の高いものを採用しています。 毎朝の朝会は日替わりの担当が1人で計画を立て、週1回の定例会議では3社が振り返って改善案を出し合います（採用された案は提案箱へ）。 あなたが議題を出して、今すぐ会議を開くこともできます。</PageIntro>
      {owner && (
        <section className="card space-y-2 p-4">
          <div>
            <h2 className="font-bold">今すぐ会議</h2>
            <p className="text-xs text-muted">議題を出すと、出席したAIがダッシュボードの数字をもとにそれぞれ意見を出し、ほかの意見を読んで反論・修正したうえで、議長が結論をまとめます。やることが出たら提案箱に入ります。</p>
          </div>
          <MeetingForm members={people} running={adhocRunning()} />
        </section>
      )}
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="会議の種類">
        <Link href="/meetings" className={`rounded-full border px-3 py-1 ${!k ? 'border-accent bg-accent text-accent-ink' : 'border-line text-ink-2'}`}>
          すべて
        </Link>
        {(Object.keys(MEETING_LABEL) as MeetingKind[]).map((x) => (
          <Link key={x} href={`/meetings?kind=${x}`} className={`rounded-full border px-3 py-1 ${k === x ? 'border-accent bg-accent text-accent-ink' : 'border-line text-ink-2'}`}>
            {MEETING_LABEL[x]}
          </Link>
        ))}
      </nav>
      {list.length ? (
        <ShowMore initial={10} className="space-y-3">
          {list.map((m) => (
            <MeetingCard key={m.key} m={m} />
          ))}
        </ShowMore>
      ) : (
        <p className="text-sm text-ink-2">直近30日の会議はありません。</p>
      )}
    </div>
  )
}
