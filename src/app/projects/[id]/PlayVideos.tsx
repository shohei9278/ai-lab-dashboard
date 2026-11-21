"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";

export type PlayVideoView = { id: number; at: string; version: number; file: string; hook: string; caption: string; ok: boolean; issues: string[] };

// 投稿先（growth.ts の SNS_PLATFORMS のうち、動画を載せる所）
const VIDEO_PLATFORMS: Record<string, string> = { x: "X", threads: "Threads", bluesky: "Bluesky", instagram: "Instagram", other: "その他" };

// 動くツールを遊ぶ様子の動画（運営者だけに見せる。投稿は、保存して手で行う）
// 投稿文の案は「投稿の下書きにする」で、SNSで広めるの下書きに、その投稿専用のリンク（?s=…）付きで入れる
// （公開ページのURLをそのまま付けると、どの投稿から来たかが分からず、投稿したものにも出ないため）
export function PlayVideos({ projectId, videos }: { projectId: number; videos: PlayVideoView[] }) {
  const router = useRouter();
  const { run, busy, error } = useLoopAction();
  const [accepted, setAccepted] = useState(false);
  const [platform, setPlatform] = useState("x");
  const [drafted, setDrafted] = useState<number | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  // 下書きにしている途中の動画（その間はボタンを押せない。2回押して同じ下書きが2つできないように。PR #100 の ai-review の指摘）
  // 画面の状態（sending）は描き直すまで変わらないので、ダブルクリックの2回目を止めるために、すぐ変わる印（ref）も持つ
  const [sending, setSending] = useState<number | null>(null);
  const sendingRef = useRef(false);
  // SNSで広めるの下書きに入れる（人の下書きとして。自動投稿には使わない）
  async function toDraft(v: PlayVideoView) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(v.id);
    setDraftError(null);
    try {
      const res = await fetch("/api/sns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", projectId, text: v.caption, platform, angle: "遊ぶ様子の動画" }) }).catch(() => null);
      if (!res?.ok) {
        const data = res ? await res.json().catch(() => ({})) : {};
        setDraftError((data as { error?: string }).error ?? "下書きにできませんでした");
        return;
      }
      setDrafted(v.id);
      router.refresh();
    } finally {
      sendingRef.current = false;
      setSending(null);
    }
  }
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">遊ぶ様子の動画</h2>
        <ActionButton disabled={!!busy} onClick={async () => { setAccepted(false); if (await run("受け付けています…", { action: "play-video", projectId })) setAccepted(true); }}>
          {videos.length ? "作り直す" : "動画を作る"}（約20円）
        </ActionButton>
      </div>
      <p className="text-xs text-muted">
        AIがツールの遊び方の台本を書き、スマホの並びで実際に動かして、縦長の動画（10〜15秒・音なし）に録画します。録画の最初・途中・最後のコマをAIが見て、何をするものか伝わるかを確かめます。必要なときに、このボタンで作ります（設定の「公開したときに動画を自動で作る」をオンにすると、ねらいが「広がる」の案件は、初めて公開したときに自動で作ります）。ほかの動画を作っている途中なら、終わってから作ります。投稿は、動画を保存し、投稿文の案を「投稿の下書きにする」で下の「SNSで広める」に入れて（その投稿専用のリンクが付きます）、そこからコピーして手で行ってください。
      </p>
      <BusyNote busy={busy} error={error} />
      {accepted && !busy && <p className="text-sm text-ink-2" role="status">受け付けました。裏で作ります（1〜2分ほど。ほかの動画を作っている途中なら、そのあと）。進み具合はホームのライブで見られ、できたら画面を読み込み直すとここに出ます（できあがるまで、同じ案件の動画は重ねて頼めません）。</p>}
      {videos.length === 0 ? (
        <p className="text-sm text-ink-2">まだありません。</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {videos.map((v) => (
              <li key={v.id} className="space-y-2">
                <video src={`/api/videos/${v.file}`} controls playsInline preload="metadata" className="w-full max-w-[240px] rounded-lg border border-line bg-black" />
                <div className="text-sm font-medium">{v.hook}</div>
                <div className="text-xs text-muted">第{v.version}版・{v.at}</div>
                {!v.ok && v.issues.length > 0 && (
                  <ul className="list-disc pl-5 text-xs" style={{ color: "var(--warning)" }}>
                    {v.issues.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                )}
                {v.caption && <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs">{v.caption}</p>}
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/videos/${v.file}`} download={v.file} data-demo-ok className="rounded-lg border border-line px-3 py-1.5 text-sm">動画を保存</a>
                  {v.caption && (
                    <>
                      <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="投稿先" className="rounded-lg border border-line bg-surface px-2 py-1 text-sm">
                        {Object.entries(VIDEO_PLATFORMS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                      <button type="button" disabled={sending !== null} onClick={() => toDraft(v)} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50">
                        {sending === v.id ? "下書きにしています…" : "投稿の下書きにする"}
                      </button>
                    </>
                  )}
                </div>
                {drafted === v.id && <p className="text-xs text-ink-2" role="status">下の「SNSで広める」の下書きに入れました（その投稿専用のリンク付き）。そこからコピーして投稿し、投稿したら記録してください。</p>}
                {draftError && <p className="text-xs" style={{ color: "var(--critical)" }} role="alert">{draftError}</p>}
              </li>
          ))}
        </ul>
      )}
    </section>
  );
}
