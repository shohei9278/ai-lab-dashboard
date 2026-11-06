import { isOwner } from "@/lib/viewer";
import { PageIntro } from "@/components/PageIntro";
import { VoiceList } from "@/components/VoiceList";
import { listVoices } from "@/lib/voices";

export const dynamic = "force-dynamic";

// 社員の声: AIの社員のつぶやき・心配・ダメ出し・試したい集客の方法
export default async function VoicesPage() {
  const owner = await isOwner();
  return (
    <div className="space-y-6">
      <PageIntro title="社員の声">
        AIの社員が、ふだんの作業（判断・教訓・LPやツールのチェック・アイデアの採点・コメントの返信の案・朝会）や定例会議の途中でこぼした、ひとことです。感想・気づき・心配・ダメ出し・試したいことなど、中身は何でもありです。
        決めることはありません。気になったものは「提案箱へ」で、仕組みの改善として提案箱に入れられます。声は週の定例会議の材料にもなります。
      </PageIntro>
      <section className="card mx-auto w-full max-w-2xl px-3 py-1">
        <VoiceList voices={listVoices({ limit: 150 })} owner={owner} />
      </section>
    </div>
  );
}
