import Link from "next/link";
import { db } from "@/lib/db";
import { NOTE_CERTAINTY, NOTE_TOPICS, listNotes, type NoteCertainty } from "@/lib/notes";
import { PageIntro } from "@/components/PageIntro";
import { LabTabs } from "@/components/LabTabs";
import { NoteActions, NoteEditor } from "./NoteEditor";
import { jstDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const CERTAINTY_STYLE: Record<NoteCertainty, string> = { once: "var(--muted)", trend: "var(--warning)", confirmed: "var(--good)" };

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  const notes = listNotes(topic);
  const all = listNotes();
  const projects = db().prepare("SELECT id, title FROM projects ORDER BY id DESC").all() as { id: number; title: string }[];
  const topics = Object.entries(NOTE_TOPICS).map(([id, label]) => ({ id, label }));
  const certainties = Object.entries(NOTE_CERTAINTY).map(([id, c]) => ({ id, label: c.label }));

  return (
    <div className="space-y-6">
      <PageIntro title="実験メモ">
        実験の途中で気づいたことを残す場所です。AIが観察したことと、あなたが気づいたことの両方を書けます。
        「確からしさ」で、1回見ただけのことと、数字で確かめたことを分けておくと、あとで発信するときに使いやすくなります。
        （AIの教訓メモとは別で、ここに書いたことはAIへの入力には使いません）
      </PageIntro>
      <LabTabs current="/notes" />

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
        <ol className="space-y-3">
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
        </ol>
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
