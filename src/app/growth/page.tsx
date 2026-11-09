import { HIDDEN, isOwner, maskHandles } from "@/lib/viewer";
import Link from "next/link";
import { getSettings } from "@/lib/db";
import { accounts, projectSns, snsPosts } from "@/lib/snsOverview";
import { ShowMore } from "@/components/ShowMore";
import { PageIntro } from "@/components/PageIntro";
import { GrowthTabs } from "@/components/LabTabs";
import { DraftControls, ForgetPost, PauseToggle, ReplyControls, SyncComments } from "./SnsActions";
import { listComments } from "@/lib/snsComments";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { x: "X", threads: "Threads", bluesky: "Bluesky", note: "note", instagram: "Instagram", line: "LINE" };
const label = (p: string) => LABEL[p] ?? p;
const jst = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const jstUtc = (s: string) => jst(s.replace(" ", "T") + "Z");

// SNSの管理: 場所ごとの状態、これから出る下書き、投稿済みの成績、案件ごとの止め方
export default async function GrowthPage() {
  const s = getSettings();
  const acc = accounts();
  const posts = snsPosts();
  const drafts = posts.filter((p) => p.status === "draft" && p.author === "ai");
  const posted = posts.filter((p) => p.status === "posted");
  const projects = projectSns();
  const shown = acc.filter((a) => a.configured);
  const owner = await isOwner();
  // 来た人には、コメントの相手と本文を伏せる（AIの返信の案は、@アカウント名を伏せて出す）
  const comments = listComments().map((c) => (owner ? c : { ...c, author: "（デモ表示）", text: HIDDEN, draft: c.draft ? maskHandles(c.draft) : c.draft, reply_url: null }));
  const open = comments.filter((c) => c.status === "new");
  const done = comments.filter((c) => c.status !== "new").slice(0, 10);

  return (
    <div className="space-y-6">
      <PageIntro title="集客">
        人を呼ぶための取り組みをまとめています。ここではAIがSNSに投稿した内容と、その成績・ついたコメントを見られます。どの手が効いたかは「効いた手」、よく伸びた他人の投稿は「話題の投稿」で見られます。
        {s.autoPost ? " 自動投稿はオンです。" : " 自動投稿はオフです（設定でオンにできます）。"}
        {s.dailyPlan
          ? ` 投稿の回数・時刻・切り口は、毎朝の計画でAIが決めます（場所ごとに直近24時間で${s.postSafetyPerDay}件の安全装置あり）。どの手が効いたかは「効いた手」のタブで見られます。`
          : ` 投稿は日本時間の8〜22時に、場所ごとに1日${s.autoPostPerDay}件まで、間隔をあけて出ます。`}
        公開したばかりの案件は、Threads・Bluesky にはその場で投稿します。
      </PageIntro>
      <GrowthTabs current="/growth" />

      {/* 場所ごとの状態 */}
      <section className="grid gap-3 md:grid-cols-3">
        {acc.map((a) => (
          <div key={a.key} className="card space-y-2 p-4" style={a.lastError ? { borderColor: "var(--critical)" } : undefined}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold">{a.label}</span>
              {a.configured
                ? <span className="text-xs" style={{ color: "var(--good)" }}>● つながっています</span>
                : <span className="text-xs text-muted">○ キー未設定</span>}
            </div>
            {a.configured ? (
              <>
                {a.handle || a.profile ? (
                  <div className="text-xs">
                    {a.profile ? <a href={a.profile} target="_blank" rel="noreferrer" className="text-accent underline">{a.handle ?? "プロフィール"} ↗</a> : a.handle}
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Mini label="投稿" value={`${a.posts}件`} />
                  <Mini label="訪問" value={`${a.visits}人`} />
                  <Mini label="成果" value={`${a.conversions}人`} />
                </div>
                <div className="num text-xs text-ink-2">
                  直近24時間 {a.today}/{a.cap}件・
                  {!s.autoPost ? "自動投稿はオフ" : a.nextAt ? `次に投稿できるのは ${jst(a.nextAt)} ごろ` : "今日の上限に達しました"}
                </div>
                <div className="num text-xs text-muted">{a.free ? "無料" : `今月の費用 ${Math.round(a.costJpy).toLocaleString("ja-JP")}円（1件 約30円）`}</div>
                {a.lastError && (
                  <p className="rounded-lg bg-surface-2 p-2 text-xs" style={{ color: "var(--critical)" }}>
                    ! 最後の投稿が失敗しました（{jstUtc(a.lastError.at)}）: {a.lastError.error}
                    <span className="block text-ink-2">2時間あけてから、自動で試し直します。</span>
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-ink-2">キーを入れると、AIが自動で投稿します（手順は docs/SETUP-SNS.md）。</p>
            )}
          </div>
        ))}
      </section>

      {/* コメント */}
      <section id="comments" className="scroll-mt-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-bold">コメント（返信待ち {open.length}件）</h2>
            <p className="text-xs text-muted">Threads・Bluesky の自分の投稿についたコメントを5分ごとに取り込み、AIが返信の案を書きます。返信は「この文で返信する」を押したときだけ送ります。X のコメントは、読むのに費用がかかるので取り込んでいません。</p>
          </div>
          <SyncComments />
        </div>
        {open.length === 0 ? (
          <div className="card p-4 text-sm text-ink-2">返信を待っているコメントはありません。</div>
        ) : (
          <ul className="space-y-2">
            {open.map((c) => (
              <li key={c.id} className="card space-y-2 p-3 text-sm">
                <div className="flex flex-wrap gap-2 text-xs text-ink-2">
                  <span className="rounded bg-surface-2 px-1.5 py-0.5">{label(c.platform)}</span>
                  <Link href={`/projects/${c.project_id}`} className="hover:underline">#{c.project_id} {c.title}</Link>
                  {c.post_url && <a href={c.post_url} target="_blank" rel="noreferrer" className="text-accent underline">元の投稿 ↗</a>}
                  {c.commented_at && <span className="text-muted">{jst(c.commented_at)}</span>}
                </div>
                <p className="line-clamp-1 text-xs text-muted">自分の投稿: {c.post_text}</p>
                <p><span className="font-medium">{c.author}</span>: {c.text}</p>
                <ReplyControls id={c.id} draft={c.draft} reason={c.draft_reason} platform={c.platform} />
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <details className="card p-3 text-sm">
            <summary className="cursor-pointer text-xs text-ink-2">返信した・返さなかったコメント（最近の{done.length}件）</summary>
            <ul className="mt-2 space-y-2">
              {done.map((c) => (
                <li key={c.id} className="text-xs">
                  <span className="text-ink-2">{label(c.platform)}・{c.author}:</span> {c.text}
                  <span className="block text-ink-2">{c.status === "replied" ? <>→ 返信: {c.draft}{c.reply_url && <a href={c.reply_url} target="_blank" rel="noreferrer" className="ml-1 text-accent underline">↗</a>}</> : "→ 返さなかった"}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* 案件ごと */}
      <section className="space-y-2">
        <div>
          <h2 className="font-bold">公開中の案件</h2>
          <p className="text-xs text-muted">場所ごとの投稿数です。チェックを外すと、その案件だけ自動投稿を止めます（公開したときの投稿も止まります）。</p>
        </div>
        {projects.length === 0 ? (
          <div className="card p-4 text-sm text-ink-2">公開中の案件はありません。</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">案件</th>
                  {shown.map((a) => <th key={a.key} className="px-3 py-2 text-right">{a.label}</th>)}
                  <th className="px-3 py-2">自動投稿</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2"><Link href={`/projects/${p.id}`} className="hover:underline">#{p.id} {p.title}</Link></td>
                    {shown.map((a) => {
                      const b = p.by[a.key];
                      return (
                        <td key={a.key} className="num px-3 py-2 text-right text-xs">
                          {b ? <>{b.n}件<span className="block text-muted">最後 {jstUtc(b.last)}</span></> : <span className="text-muted">まだ</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2"><PauseToggle projectId={p.id} paused={p.paused} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* これから出る下書き */}
      <section className="space-y-2">
        <div>
          <h2 className="font-bold">これから投稿される下書き（{drafts.length}件）</h2>
          <p className="text-xs text-muted">自動投稿は、まずここにある下書きを使います。気になる文は、投稿される前に直すか消してください（消すと、次の投稿のときにAIが書き直します）。</p>
        </div>
        {drafts.length === 0 ? (
          <div className="card p-4 text-sm text-ink-2">いまは下書きがありません。投稿するときに、AIがその場で書きます。</div>
        ) : (
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.id} className="card space-y-2 p-3 text-sm">
                <div className="flex flex-wrap gap-2 text-xs text-ink-2">
                  <span className="rounded bg-surface-2 px-1.5 py-0.5">{label(d.platform)}</span>
                  <Link href={`/projects/${d.project_id}`} className="hover:underline">#{d.project_id} {d.title}</Link>
                  {d.angle && <span className="text-muted">{d.angle}</span>}
                </div>
                <p className="whitespace-pre-wrap">{d.text}</p>
                <DraftControls id={d.id} text={d.text} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 投稿済み */}
      <section className="space-y-2">
        <div>
          <h2 className="font-bold">投稿済み（{posted.length}件）</h2>
          <p className="text-xs text-muted">訪問・成果は、投稿ごとの専用リンクから来た人の数です（5分ごとに取り込みます）。SNSの側で投稿を消したときは「記録から外す」を押してください。</p>
        </div>
        {posted.length === 0 ? (
          <div className="card p-4 text-sm text-ink-2">まだ投稿はありません。</div>
        ) : (
          <div className="card overflow-x-auto">
            <ShowMore as="table" initial={15} className="w-full text-sm" head={<thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">日時</th>
                  <th className="px-3 py-2">場所</th>
                  <th className="px-3 py-2">案件・本文</th>
                  <th className="px-3 py-2 text-right">訪問</th>
                  <th className="px-3 py-2 text-right">成果</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>}>
                {posted.map((p) => (
                  <tr key={p.id} className="border-b border-line align-top last:border-0">
                    <td className="num px-3 py-2 whitespace-nowrap text-xs text-ink-2">{p.posted_at ? jstUtc(p.posted_at) : "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{label(p.platform)}{p.author === "human" && <span className="block text-muted">あなた</span>}</td>
                    <td className="px-3 py-2">
                      <Link href={`/projects/${p.project_id}`} className="text-xs text-ink-2 hover:underline">#{p.project_id} {p.title}</Link>
                      <p className="line-clamp-2 text-xs" title={p.text}>{p.text}</p>
                    </td>
                    <td className="num px-3 py-2 text-right">{p.visits}</td>
                    <td className="num px-3 py-2 text-right">{p.conversions}<span className="block text-[10px] text-muted">{p.noun}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap text-right text-xs">
                      {p.post_url && <a href={p.post_url} target="_blank" rel="noreferrer" className="block text-accent underline">投稿を見る ↗</a>}
                      <ForgetPost id={p.id} />
                    </td>
                  </tr>
                ))}
            </ShowMore>
          </div>
        )}
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-2">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="num text-sm font-bold">{value}</div>
    </div>
  );
}
