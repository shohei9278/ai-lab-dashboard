import { recentToolCheckIssues, toolCheckWeeks } from "@/lib/toolCheckStats";
import { jstDateTime } from "@/lib/format";

const pctText = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

// AIの成績: ツールのチェックの止めた割合（週ごと）。項目が増えて止めすぎが増えていないかを見る（運営者が決めた）
export function ToolCheckCard({ owner }: { owner: boolean }) {
  const weeks = toolCheckWeeks();
  const issues = owner ? recentToolCheckIssues() : [];
  const max = Math.max(1, ...weeks.map((w) => w.checks));
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">ツールのチェックの止めた割合</h2>
        <p className="text-xs text-muted">
          ツールを公開する前に、AIがコードを読んで問題がないかを確かめています。チェックの項目は、実際に起きた失敗から少しずつ増やしているので、止めすぎが増えていないかを週ごとの割合で見ます（上の公開前チェックのテストは、紹介ページのチェックだけを測っています）。
          「概算」の週は記録を始める前で、決まり・自動テストの指摘で止めたものも含みます。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-normal">週（月曜から）</th>
              <th className="py-1 text-right font-normal">チェック</th>
              <th className="py-1 text-right font-normal">止めた</th>
              <th className="py-1 text-right font-normal">割合</th>
              <th className="w-1/3 py-1 pl-3 font-normal"><span className="sr-only">割合の棒</span></th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.week} className="border-t border-line">
                <td className="num py-1.5">{w.week.slice(5).replace("-", "/")}{w.estimate && <span className="ml-1 text-xs text-muted">概算</span>}</td>
                <td className="num py-1.5 text-right">{w.checks}回</td>
                <td className="num py-1.5 text-right">{w.flagged}回</td>
                <td className="num py-1.5 text-right font-medium">{pctText(w.rate)}</td>
                <td className="py-1.5 pl-3">
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2" title={`チェック${w.checks}回のうち${w.flagged}回止めた`}>
                    <div className="h-full rounded-full" style={{ width: `${(w.checks / max) * 100}%`, background: "var(--line)" }}>
                      <div className="h-full rounded-full" style={{ width: `${w.checks ? (w.flagged / w.checks) * 100 : 0}%`, background: "var(--warning)" }} />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {owner && issues.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-accent">最近、AIのチェックが止めたときの指摘（{issues.length}件）</summary>
          <ul className="mt-2 space-y-1.5 text-xs">
            {issues.map((x, i) => (
              <li key={i}>
                <span className="num text-muted">{jstDateTime(x.at)}</span> <b>{x.title ?? "（案件なし）"}</b>
                <span className="text-muted">（{x.by === "claude-code" ? "Claude Code で作ったツール" : "AIが書いたツール"}）</span>
                <div className="mt-0.5 break-words text-ink-2">{x.issues.join(" / ") || "（指摘の文なし）"}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
