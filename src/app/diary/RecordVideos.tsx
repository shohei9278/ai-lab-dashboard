"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RECORD_VIDEO_KINDS, type RecordVideoKind } from "@/lib/recordVideoKinds";
import { CopyNote } from "./DiaryActions";

type Item = { id: number; at: string; kind: RecordVideoKind; title: string; caption: string; file: string };

// 実験の記録の動画を作る（個人のアカウントに手で投稿する用）
export function RecordVideos({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<RecordVideoKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wish, setWish] = useState("");
  const make = async (kind: RecordVideoKind) => {
    setBusy(kind);
    setError(null);
    const res = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, instruction: wish }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!res.ok) setError(data.error ?? "作れませんでした");
    router.refresh();
  };
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">実験の記録の動画（あなただけに見えています）</h2>
        <p className="text-xs text-muted">本物の記録からAIが台本を書き、縦長の短い動画（音なし）を作ります。内容を確かめてから、個人のアカウントに手で投稿してください。字幕の動画は1本 約5〜10円（ダッシュボードの動画はAIを使わないので無料）、1〜2分かかります。</p>
      </div>
      <label className="block text-xs text-ink-2">
        見せ方の希望（任意。「ダッシュボードを見せる」には使いません）
        <input
          value={wish} onChange={(e) => setWish(e.target.value)} maxLength={200} placeholder="例: 費用の話を中心に / GPTとGeminiの対立を強めに"
          className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
        <span className="mt-1 block text-muted">事実や数字は変わりません。元の記録にない数字は自動で弾きます。</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RECORD_VIDEO_KINDS) as RecordVideoKind[]).map((k) => (
          <button key={k} type="button" disabled={!!busy} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => make(k)}>
            {busy === k ? "作っています（1〜2分）…" : `「${RECORD_VIDEO_KINDS[k]}」を作る`}
          </button>
        ))}
      </div>
      {error && <p className="text-xs" style={{ color: "var(--critical)" }}>{error}</p>}
      {items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((v) => (
            <li key={v.id} className="space-y-2">
              <video src={`/api/videos/${v.file}`} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-lg border border-line bg-black" />
              <div className="text-sm font-medium">{v.title}</div>
              <p className="whitespace-pre-wrap text-xs text-ink-2">{v.caption}</p>
              <div className="flex flex-wrap items-center gap-3">
                <CopyNote text={v.caption} />
                <a href={`/api/videos/${v.file}`} download={v.file} className="text-sm text-accent underline">動画を保存</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
