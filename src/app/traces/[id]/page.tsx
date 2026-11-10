import Link from "next/link";
import { notFound } from "next/navigation";
import { jstDateTime } from "@/lib/format";
import { modelInfo } from "@/lib/models";
import { getTrace } from "@/lib/traces";
import { isOwner } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const Block = ({ title, text }: { title: string; text: string }) => (
  <section className="card space-y-2 p-4">
    <h2 className="font-bold">{title}</h2>
    <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-xs">{text}</pre>
  </section>
);

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) notFound();
  const t = getTrace(Number((await params).id));
  if (!t) notFound();
  return (
    <div className="space-y-4">
      <Link href="/traces" className="text-sm text-accent underline">← AIの入出力</Link>
      <div>
        <h1 className="text-xl font-bold">{t.purpose}</h1>
        <p className="num text-sm text-ink-2">{jstDateTime(t.at)}・{modelInfo(t.model_id).label}{t.project_id ? `・${t.title ?? `#${t.project_id}`}` : ""}</p>
      </div>
      {t.error && <p className="card p-3 text-sm" style={{ color: "var(--critical)" }}>{t.error}</p>}
      {t.system && <Block title="指示（system）" text={t.system} />}
      <Block title={`入力（${t.input_chars.toLocaleString("ja-JP")}字）`} text={t.input} />
      <Block title={`出力（${t.output_chars.toLocaleString("ja-JP")}字）`} text={t.output ?? "（出力なし）"} />
    </div>
  );
}
