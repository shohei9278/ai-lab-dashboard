import { officeSnapshot } from "@/lib/office";
import { PageIntro } from "@/components/PageIntro";
import { OfficeView } from "./OfficeView";

export const dynamic = "force-dynamic";

// オフィス（試作）: AIの社員3人が、いま何をしているかを部屋の位置で見せる
export default function OfficePage() {
  return (
    <div className="space-y-4">
      <PageIntro title="オフィス（試作）">
        AIの社員（Claude・GPT・Gemini）が、いまどこで何をしているかを見せる画面です。LPやツールを作っていれば開発室、判断・会議・採点をしていれば会議室、投稿をしていれば広報デスクにいて、手が空くと休憩室に戻ります。
        社員の声と提案は吹き出しで出ます。だれも動いていないときは、直近24時間の動きを早送りで再生します。
      </PageIntro>
      <OfficeView initial={officeSnapshot()} />
    </div>
  );
}
