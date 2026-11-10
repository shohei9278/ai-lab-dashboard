import Link from "next/link";
import { notFound } from "next/navigation";
import { PageIntro } from "@/components/PageIntro";
import { jstDateTime } from "@/lib/format";
import { modelInfo } from "@/lib/models";
import { listTraces } from "@/lib/traces";
import { isOwner } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// AIに渡した入力と出力の控え。ツールの中身や投稿の文面が入るので、運営者だけが見られる
export default async function TracesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  if (!(await isOwner())) notFound();
  const project = Number((await searchParams).project) || undefined;
  const list = listTraces(project);
  return (
    <div className="space-y-4">
      <PageIntro title="AIの入出力">
        不具合の原因を調べるための控えです。AIに渡した内容と返ってきた内容を、直近200件・7日分だけ残しています。あなただけに見えています。
      </PageIntro>
      {project && <Link href="/traces" className="text-sm text-accent underline">すべての案件を見る</Link>}
      {list.length === 0 ? <p className="card p-4 text-sm text-ink-2">まだ記録はありません。次にAIが動くと、ここに残ります。</p> : (
        <ul className="card divide-y divide-line">
          {list.map((t) => (
            <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 text-sm">
              <span className="num text-xs text-muted">{jstDateTime(t.at)}</span>
              <Link href={`/traces/${t.id}`} className="font-medium text-accent underline">{t.purpose}</Link>
              <span className="text-xs text-ink-2">{modelInfo(t.model_id).label}</span>
              {t.project_id && <Link href={`/traces?project=${t.project_id}`} className="text-xs text-ink-2 underline">{t.title ?? `#${t.project_id}`}</Link>}
              <span className="num ml-auto text-xs text-muted">入力 {t.input_chars.toLocaleString("ja-JP")}字・出力 {t.output_chars.toLocaleString("ja-JP")}字</span>
              {t.error && <span className="w-full text-xs" style={{ color: "var(--critical)" }}>{t.error.slice(0, 160)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
