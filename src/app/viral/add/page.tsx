import { queueViral, tweetIdOf } from "@/lib/viralPosts";
import { CloseSoon } from "../../refs/add/CloseSoon";

export const dynamic = "force-dynamic";

// ブックマークレットから開かれる小さな窓。Xの投稿のURLを受け付けて、すぐ閉じる
export default async function AddViral({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const { url } = await searchParams;
  const ok = !!url && !!tweetIdOf(url);
  const added = ok ? queueViral([url]) : 0;
  return (
    <div className="space-y-2 text-sm">
      <h1 className="font-bold">話題の投稿</h1>
      {!ok ? (
        <p style={{ color: "var(--critical)" }}>Xの投稿のページ（…/status/…）を開いてから押してください。</p>
      ) : added ? (
        <p style={{ color: "var(--good)" }}>✓ 受け付けました。AIが「なぜ伸びたか」をまとめます（1件 30秒ほど）。</p>
      ) : (
        <p className="text-ink-2">この投稿は、もう入っています。</p>
      )}
      <p className="break-all text-xs text-muted">{url}</p>
      <CloseSoon />
    </div>
  );
}
