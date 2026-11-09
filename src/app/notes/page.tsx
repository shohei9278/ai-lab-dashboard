import Link from "next/link";
import { db } from "@/lib/db";
import { NOTE_CERTAINTY, NOTE_TOPICS, listNotes, type NoteCertainty } from "@/lib/notes";
import { ShowMore } from "@/components/ShowMore";
import { PageIntro } from "@/components/PageIntro";
import { LibraryTabs } from "@/components/LabTabs";
import { CERTAINTY_LABEL, activeLessons } from "@/lib/loop";
import { NoteActions, NoteEditor } from "./NoteEditor";
import { jstDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const CERTAINTY_STYLE: Record<NoteCertainty, string> = { once: "var(--muted)", trend: "var(--warning)", confirmed: "var(--good)" };

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  const notes = listNotes(topic);
  const lessons = activeLessons();
  const all = listNotes();
  const projects = db().prepare("SELECT id, title FROM projects ORDER BY id DESC").all() as { id: number; title: string }[];
  const topics = Object.entries(NOTE_TOPICS).map(([id, label]) => ({ id, label }));
  const certainties = Object.entries(NOTE_CERTAINTY).map(([id, c]) => ({ id, label: c.label }));

  return (
    <div className="space-y-6">
      <PageIntro title="社内の知見">
        実験で分かったことを残す場所です。上は案件が終わるたびにAIの社員が書く「教訓」（次のアイデア出しや計画で参照されます）、下はあなたやAIが書く「実験メモ」（発信の材料用。AIへの入力には使いません）です。
        「確からしさ」で、1回見ただけのことと、数字で確かめたことを分けておくと、あとで発信するときに使いやすくなります。
      </PageIntro>
      <LibraryTabs current="/notes" />

      {/* 教訓 */}
      <section className="space-y-2">
        <div>
          <h2 className="font-bold">AIの教訓（{lessons.length}件）</h2>
          <p className="text-xs text-muted">終わった案件からAIが学んだこと。事実・仮の解釈・まだ分からないことに分けて残し、次のアイデア出しで参照されます。訪問が判断の基準に届かなかった案件の教訓は、確かさ「低（保留）」になります。</p>
        </div>
        <div className="card divide-y divide-line text-sm">
          {lessons.length ? lessons.map((l) => (
            <div key={l.id} className="space-y-1 p-3">
              <div>
                {l.certainty && <span className="mr-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">確かさ {CERTAINTY_LABEL[l.certainty]}</span>}
                {l.interpretation ?? l.text}
                {l.project_id && <Link href={`/projects/${l.project_id}`} className="ml-2 text-xs text-accent underline">案件</Link>}
              </div>
              {l.fact && <div className="text-xs text-ink-2">事実: {l.fact}</div>}
              {l.unknown && <div className="text-xs text-muted">まだ分からない: {l.unknown}</div>}
            </div>
          )) : <div className="p-3 text-ink-2">まだありません。案件が終わると、AIが教訓を書きます。</div>}
        </div>
      </section>

      <h2 className="font-bold">実験メモ</h2>

      <section className="card p-4">
        <h2 className="mb-3 font-bold">メモを追加</h2>
        <NoteEditor initial={{ topic: "other", certainty: "once", title: "", body: "", projectId: null, isPublic: false }} topics={topics} certainties={certainties} projects={projects} />
      </section>

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="分類で絞り込む">
        <Chip href="/notes" active={!topic}>すべて {all.length}</Chip>
        {topics.map((t) => {
          const n = all.filter((x) => x.topic === t.id).length;
          return n ? <Chip key={t.id} href={`/notes?topic=${t.id}`} active={topic === t.id}>{t.label} {n}</Chip> : null;
        })}
      </nav>

      {notes.length === 0 ? (
        <div className="card p-6 text-sm text-ink-2">まだメモがありません。</div>
      ) : (
        <ShowMore as="ol" initial={10} className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                <span className="num text-muted">{jstDate(n.at)}</span>
                <span className="rounded border border-line px-1.5 py-0.5">{NOTE_TOPICS[n.topic]}</span>
                <span className="inline-flex items-center gap-1" title={NOTE_CERTAINTY[n.certainty].note}>
                  <span aria-hidden style={{ color: CERTAINTY_STYLE[n.certainty] }}>●</span>{NOTE_CERTAINTY[n.certainty].label}
                </span>
                <span className="font-medium" style={{ color: n.author === "ai" ? "var(--accent)" : "var(--text-2)" }}>{n.author === "ai" ? "AIの観察" : "あなた"}</span>
                {n.is_public ? <span className="rounded bg-surface-2 px-1.5 py-0.5">公開ページに掲載</span> : null}
                {n.project_id && <Link href={`/projects/${n.project_id}`} className="text-accent underline">#{n.project_id} {n.project_title}</Link>}
              </div>
              <h3 className="mt-1 font-bold">{n.title}</h3>
              {n.body && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{n.body}</p>}
              <NoteActions
                draft={{ id: n.id, topic: n.topic, certainty: n.certainty, title: n.title, body: n.body, projectId: n.project_id, isPublic: !!n.is_public }}
                topics={topics}
                certainties={certainties}
                projects={projects}
              />
            </li>
          ))}
        </ShowMore>
      )}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`num rounded-full border px-3 py-1 ${active ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2 hover:text-ink"}`}>
      {children}
    </Link>
  );
}
