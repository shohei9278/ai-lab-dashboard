import { commitUrl, foundByLabels, INTERVENTION_KIND, type InterventionRow } from "@/lib/interventions";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="text-xs text-muted">{label}</div>
    <p className="text-sm">{children}</p>
  </div>
);

// 人の手が入った記録の1件ずつ（公開ページとダッシュボードで共通）
export function InterventionCard({ v, children }: { v: InterventionRow; children?: React.ReactNode }) {
  return (
    <article className="card space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">{INTERVENTION_KIND[v.kind]}</span>
        <span className="num text-xs text-muted">{v.day.slice(5).replace("-", "/")}</span>
        {foundByLabels(v.found_by).length > 0 && <span className="text-xs text-ink-2">見つけた: {foundByLabels(v.found_by).join("・")}</span>}
        {children && <span className="ml-auto">{children}</span>}
      </div>
      <h2 className="font-bold">{v.title}</h2>
      <Row label="問題">{v.happened}</Row>
      <Row label="人の対応">{v.noticed}</Row>
      <Row label="AIの対応">{v.decision}</Row>
      {v.result && <Row label="結果">{v.result}</Row>}
      {v.commit_sha && <a href={commitUrl(v.commit_sha)} target="_blank" rel="noreferrer" className="num inline-block text-xs text-accent underline">修正のコミット {v.commit_sha} ↗</a>}
    </article>
  );
}
