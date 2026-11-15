import Link from "next/link";
import type { Funnel } from "@/lib/funnel";
import { channelSteps, type ChannelRow } from "@/lib/channels";

const pc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

// ページの中での動き: 訪問した人が、どこまで進んだか
export function FunnelCard({ f, isTool, projectId, all, liveVersion, channels }: { f: Funnel; isTool: boolean; projectId: number; all: Funnel[]; liveVersion: number; channels: ChannelRow[] }) {
  // いちばん大きく減っている段（前の段からの割合が最も低いところ）
  let worst = -1;
  let worstRate = 1;
  f.steps.forEach((s, i) => {
    if (i === 0 || !f.steps[i - 1].visitors) return;
    const r = s.visitors / f.steps[i - 1].visitors;
    if (r < worstRate) { worstRate = r; worst = i; }
  });
  return (
    <section id="funnel" className="card scroll-mt-4 space-y-4 p-4">
      <div>
        <h2 className="font-bold">ページの中での動き（第{f.version}版{f.version === liveVersion ? "・公開中" : ""}）</h2>
        <p className="text-xs text-muted">
          訪問した人が、どこまで進んだかです。人数は訪問者ごと・1日1回で数えます。あなたのブラウザ（?me=1 を付けたもの）は数えません。
        </p>
      </div>
      {all.length > 1 && (
        <div className="space-y-2">
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="版を選ぶ">
            {all.map((x) => (
              <Link key={x.version} href={`/projects/${projectId}?fv=${x.version}#funnel`} scroll={false} aria-current={x.version === f.version ? "true" : undefined} className={`num rounded-full border px-3 py-1 ${x.version === f.version ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2"}`}>
                第{x.version}版{x.version === liveVersion ? "（公開中）" : ""}
              </Link>
            ))}
          </nav>
          {/* 版どうしを見比べる（訪問に対する割合） */}
          <div className="overflow-x-auto">
            <table className="m-scroll w-full text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">版</th>
                  {all[0].steps.map((s) => <th key={s.key} className="py-1 pr-3 font-normal">{s.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {all.map((x) => (
                  <tr key={x.version} className="border-t border-line" style={x.version === f.version ? { fontWeight: 700 } : undefined}>
                    <td className="num whitespace-nowrap py-1 pr-3">第{x.version}版</td>
                    {x.steps.map((s) => <td key={s.key} className="num whitespace-nowrap py-1 pr-3">{s.visitors}人{s.key !== "visit" ? `（${pc(s.ofVisits)}）` : ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!f.visits ? (
        <p className="text-sm text-ink-2">この版には、まだ訪問がありません。</p>
      ) : (
        <>
          <ol className="space-y-2">
            {f.steps.map((s, i) => (
              <li key={s.key}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {s.label}
                    {i === worst && worstRate < 1 && <span className="ml-2 text-xs" style={{ color: "var(--warning)" }}>▼ ここで一番減っています</span>}
                  </span>
                  <span className="num shrink-0">
                    <b>{s.visitors}人</b>
                    <span className="ml-2 text-xs text-ink-2">{pc(s.ofVisits)}</span>
                    {i > 0 && f.steps[i - 1].visitors > 0 && <span className="ml-2 text-xs text-muted">前の段から {pc(s.visitors / f.steps[i - 1].visitors)}</span>}
                  </span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(1, (s.ofVisits ?? 0) * 100)}%`, background: "var(--accent)" }} />
                </div>
              </li>
            ))}
          </ol>
          {!f.hasEvents && (
            <p className="text-xs text-muted">
              この版では、まだ「読んだ」「ボタン」「入力」の記録がありません。訪問が少ないうちは、どの人も半分まで読まずに離れると0のままです（記録の仕組みは動いています）。
            </p>
          )}
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-muted">どこまで読んだか</div>
              <ul className="space-y-1">
                {f.depth.map((d) => (
                  <li key={d.percent} className="num flex justify-between"><span>{d.percent === 100 ? "最後まで" : `${d.percent}%まで`}</span><span>{d.visitors}人（{pc(f.visits ? d.visitors / f.visits : null)}）</span></li>
                ))}
              </ul>
            </div>
            {f.sections.length > 0 && !isTool && (
              <div>
                <div className="mb-1 text-xs text-muted">見られた部分（半分以上が画面に入った人）</div>
                <ul className="space-y-1">
                  {f.sections.map((s) => <li key={s.section} className="num flex justify-between"><span>{s.section}</span><span>{s.visitors}人</span></li>)}
                </ul>
              </div>
            )}
            {f.errors > 0 && <p className="text-xs" style={{ color: "var(--critical)" }}>登録しようとして失敗した人: {f.errors}人</p>}
          </div>
          <Channels rows={channels} isTool={isTool} />
        </>
      )}
    </section>
  );
}

// どこから来たか: 流入元ごとの人数と、そこから来た人がどこまで進んだか
function Channels({ rows, isTool }: { rows: ChannelRow[]; isTool: boolean }) {
  const steps = channelSteps(isTool);
  const total = rows.reduce((n, r) => n + r.visitors, 0);
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div>
        <div className="text-sm font-medium">どこから来たか</div>
        <p className="text-xs text-muted">SNSの投稿の専用リンクから来た人は、その投稿の場所に数えます（Threads から来た人は、来た元が Facebook と記録されるため）。1人は、この版で最初に来たときの流入元で数えます。来た元のページは、サイト名だけを使います。</p>
      </div>
      {!rows.length ? (
        <p className="text-sm text-ink-2">まだ記録がありません。5分ごとの取り込みで出ます。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="m-scroll w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 pr-3 font-normal">流入元</th>
                <th className="py-1.5 pr-3 text-right font-normal">訪問</th>
                {steps.map((s) => <th key={s.key} className="py-1.5 pr-3 text-right font-normal">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.key}:${r.host ?? ""}`} className="border-b border-line last:border-0">
                  <td className="min-w-28 py-1.5 pr-3">{r.label}</td>
                  <td className="num py-1.5 pr-3 text-right">{r.visitors}人<span className="ml-1 text-xs text-muted">{pc(total ? r.visitors / total : null)}</span></td>
                  {steps.map((s) => {
                    const n = r.steps[s.key] ?? 0;
                    return <td key={s.key} className="num py-1.5 pr-3 text-right">{n}人<span className="ml-1 text-xs text-muted">{pc(r.visitors ? n / r.visitors : null)}</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
