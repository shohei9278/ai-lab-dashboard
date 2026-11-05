import { queueRefs } from "@/lib/designRefs";
import { CloseSoon } from "./CloseSoon";

export const dynamic = "force-dynamic";

// ブックマークレットから開かれる小さな窓。URLを受け付けて、すぐ閉じる
export default async function AddRef({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const { url } = await searchParams;
  const ok = !!url && /^https:\/\//.test(url);
  const added = ok ? queueRefs([url]) : 0;
  return (
    <div className="space-y-2 text-sm">
      <h1 className="font-bold">デザインの参考</h1>
      {!ok ? (
        <p style={{ color: "var(--critical)" }}>https:// で始まるページで押してください。</p>
      ) : /rdlp\.jp\/lp-archive|sankoudesign\.com/.test(url) ? (
        <p style={{ color: "var(--critical)" }}>まとめサイトのページは取り込みません。元のLPのページを開いてから押してください。</p>
      ) : added ? (
        <p style={{ color: "var(--good)" }}>✓ 受け付けました。画面を撮ってタグを付けます（1件 30秒ほど）。</p>
      ) : (
        <p className="text-ink-2">このページは、もうライブラリに入っています。</p>
      )}
      <p className="break-all text-xs text-muted">{url}</p>
      <CloseSoon />
    </div>
  );
}
