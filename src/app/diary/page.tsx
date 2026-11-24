import { isOwner } from "@/lib/viewer";
import { PageIntro } from "@/components/PageIntro";
import { DiaryTabs } from "@/components/LabTabs";
import { ShowMore } from "@/components/ShowMore";
import { getSettings } from "@/lib/db";
import { modelInfo } from "@/lib/models";
import { listDiaries, type DiaryContent, type DiaryRow } from "@/lib/diary";
import { WriteDiary } from "./DiaryActions";

export const dynamic = "force-dynamic";

const List = ({ title, items }: { title: string; items: string[] }) =>
  items.length ? (
    <div>
      <div className="text-xs text-muted">{title}</div>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  ) : null;

function Diary({ d }: { d: DiaryRow }) {
  const c = JSON.parse(d.content) as DiaryContent;
  const m = modelInfo(d.model_id);
  const n = c.numbers;
  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num font-bold">{d.day.slice(5).replace("-", "/")}</span>
        <span className="text-xs" style={{ color: `var(--series-${m.provider})` }}>担当 {m.label}</span>
        <span className="text-xs text-ink-2">ネック: {n.bottleneck}</span>
        <span className="num ml-auto text-xs text-ink-2">
          予定 {n.done}/{n.total}件・訪問 {n.visits}人{n.predictedVisits !== null ? `（予想 ${n.predictedVisits}人）` : ""}・登録/利用 {n.conversions}人
        </span>
      </div>
      <h2 className="font-bold">{c.headline}</h2>
      <List title="やったこと" items={c.did} />
      <List title="分かったこと" items={c.learned} />
      <List title="効かなかったこと・できなかったこと" items={c.failed} />
      {c.tomorrow && <p className="text-sm"><span className="text-xs text-muted">明日は: </span>{c.tomorrow}</p>}
    </article>
  );
}

// 日報: 毎晩AIが書く、1日の結果の記録
export default async function DiaryPage() {
  const owner = await isOwner();
  const s = getSettings();
  const list = listDiaries();
  return (
    <div className="space-y-6">
      <PageIntro title="日報とつぶやき" actions={owner ? <WriteDiary label="今日の日報を今すぐ書く（約10〜20円）" /> : undefined}>
        毎晩、その日の朝会を担当したAIの社員が、朝の計画に対して実際にどうだったかを書きます。うまくいかなかったことも、そのまま残します。
        {s.dailyReport ? "" : "（設定で、毎晩の日報は止めています）"}
      </PageIntro>
      <DiaryTabs current="/diary" />
      {list.length ? (
        <ShowMore initial={7} className="space-y-3">{list.map((d) => <Diary key={d.id} d={d} />)}</ShowMore>
      ) : <p className="card p-4 text-sm text-ink-2">まだ日報はありません。毎晩22時以降に、その日の分が書かれます。</p>}
    </div>
  );
}
