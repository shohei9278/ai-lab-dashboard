import { DATASETS, type TaskType } from "@/lib/tasks";
import { AUTHOR_LABEL } from "@/lib/format";

export default function DatasetsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">問題データ</h1>
        <p className="text-sm text-ink-2">
          <code>src/data/*.json</code> を編集すると反映されます。請求書はすべて架空のデータです。
        </p>
      </div>
      {(Object.keys(DATASETS) as TaskType[]).map((t) => {
        const ds = DATASETS[t];
        return (
          <section key={t} className="space-y-2">
            <h2 className="font-bold">{ds.title}（{ds.items.length}問）</h2>
            <p className="text-xs text-muted">{ds.labels ? `ラベル: ${ds.labels.join(" / ")}` : `項目: ${ds.fields!.join(", ")}`}</p>
            <div className="card overflow-x-auto">
              <table className="m-scroll w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">作成者</th>
                    <th className="px-3 py-2">入力</th>
                    <th className="px-3 py-2">正解</th>
                  </tr>
                </thead>
                <tbody>
                  {ds.items.map((it) => (
                    <tr key={it.id} className="border-b border-line align-top last:border-0">
                      <td className="px-3 py-2 text-ink-2">{it.id}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-ink-2">{AUTHOR_LABEL[it.author] ?? it.author}</td>
                      <td className="min-w-52 px-3 py-2 whitespace-pre-wrap">{it.input}</td>
                      <td className="min-w-72 px-3 py-2 font-mono text-xs whitespace-pre-wrap">
                        {typeof it.answer === "string" ? it.answer : JSON.stringify(it.answer, null, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
