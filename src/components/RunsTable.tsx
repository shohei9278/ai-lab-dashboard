import Link from "next/link";
import type { RunRow } from "@/lib/db";
import { modelInfo } from "@/lib/models";
import { LANG_LABEL, TASK_LABEL, VARIANT_LABEL, type PromptLang, type PromptVariant, type TaskType } from "@/lib/tasks";
import { jstDateTime, yen } from "@/lib/format";
import { MockBadge, StatusBadge } from "./ui";

export function RunsTable({ runs, usdJpy }: { runs: RunRow[]; usdJpy: number }) {
  if (!runs.length) {
    return (
      <div className="card p-6 text-sm text-ink-2">
        まだ実行がありません。<Link href="/runs/new" className="text-accent underline">新規実行</Link>から始めてください。
      </div>
    );
  }
  return (
    <div className="card overflow-x-auto">
      <table className="m-scroll w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">日時</th>
            <th className="px-3 py-2">タスク</th>
            <th className="px-3 py-2">条件</th>
            <th className="px-3 py-2">モデル</th>
            <th className="px-3 py-2">状態</th>
            <th className="px-3 py-2 text-right">進捗</th>
            <th className="px-3 py-2 text-right">費用</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const models: string[] = JSON.parse(r.models);
            return (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                <td className="px-3 py-2"><Link href={`/runs/${r.id}`} className="text-accent underline">{r.id}</Link></td>
                <td className="num px-3 py-2 whitespace-nowrap text-ink-2">{jstDateTime(r.created_at)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{TASK_LABEL[r.task as TaskType]} <MockBadge mock={!!r.mock} /></td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-2">
                  {VARIANT_LABEL[r.variant as PromptVariant]}・{LANG_LABEL[r.lang as PromptLang]}・{r.reps}回
                </td>
                <td className="min-w-56 px-3 py-2 text-ink-2">{models.map((m) => modelInfo(m).label).join(", ")}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="num px-3 py-2 text-right">{r.done_calls}/{r.total_calls}</td>
                <td className="num px-3 py-2 text-right">{r.mock ? "—" : yen(r.actual_usd, usdJpy)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
