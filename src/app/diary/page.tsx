import { isOwner } from "@/lib/viewer";
import { PageIntro } from "@/components/PageIntro";
import { DiaryTabs } from "@/components/LabTabs";
import { ShowMore } from "@/components/ShowMore";
import { getSettings } from "@/lib/db";
import { modelInfo } from "@/lib/models";
import { listDiaries, type DiaryContent, type DiaryImage, type DiaryRow } from "@/lib/diary";
import { CopyNote, WriteDiary } from "./DiaryActions";
import { RecordVideos } from "./RecordVideos";
import { listRecordVideos } from "@/lib/recordVideo";

export const dynamic = "force-dynamic";

const List = ({ title, items }: { title: string; items: string[] }) =>
  items.length ? (
    <div>
      <div className="text-xs text-muted">{title}</div>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  ) : null;

function Diary({ d, owner }: { d: DiaryRow; owner: boolean }) {
  const c = JSON.parse(d.content) as DiaryContent;
  const images = JSON.parse(d.images) as DiaryImage[];
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
      {owner && (
        <details className="border-t border-line pt-2">
          <summary className="cursor-pointer text-sm text-ink-2">note の下書き（あなただけに見えています）</summary>
          <div className="mt-2 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <CopyNote text={`${d.note_title}\n\n${d.note_body}`} />
              <span className="text-xs text-muted">【ここに感想を記載】の所に、あなたの言葉を書いて投稿してください。</span>
            </div>
            <div className="rounded-lg bg-surface-2 p-3">
              <div className="font-bold">{d.note_title}</div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{d.note_body}</p>
            </div>
            {images.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {images.map((i) => (
                  <a key={i.file} href={`/api/screenshots/${i.file}`} download={i.file} className="block shrink-0 space-y-1 text-xs text-ink-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/screenshots/${i.file}`} alt={i.label} className="h-40 w-auto rounded-lg border border-line" />
                    <span className="underline">{i.label}を保存</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
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
      {owner && <RecordVideos items={listRecordVideos()} />}
      {list.length ? (
        <ShowMore initial={7} className="space-y-3">{list.map((d) => <Diary key={d.id} d={d} owner={owner} />)}</ShowMore>
      ) : <p className="card p-4 text-sm text-ink-2">まだ日報はありません。毎晩22時以降に、その日の分が書かれます。</p>}
    </div>
  );
}
