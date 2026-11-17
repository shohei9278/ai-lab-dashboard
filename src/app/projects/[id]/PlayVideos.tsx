"use client";

import { useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";

export type PlayVideoView = { id: number; at: string; version: number; file: string; hook: string; caption: string; ok: boolean; issues: string[] };

// 動くツールを遊ぶ様子の動画（運営者だけに見せる。投稿は、保存して手で行う）
// link: 投稿に付けるページのリンク（投稿文の案に足してコピーする）
export function PlayVideos({ projectId, videos, link }: { projectId: number; videos: PlayVideoView[]; link: string | null }) {
  const { run, busy, error } = useLoopAction();
  const [accepted, setAccepted] = useState(false);
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">遊ぶ様子の動画</h2>
        <ActionButton disabled={!!busy} onClick={async () => { setAccepted(false); if (await run("受け付けています…", { action: "play-video", projectId })) setAccepted(true); }}>
          {videos.length ? "作り直す" : "動画を作る"}（約20円）
        </ActionButton>
      </div>
      <p className="text-xs text-muted">
        AIがツールの遊び方の台本を書き、スマホの並びで実際に動かして、縦長の動画（10〜15秒・音なし）に録画します。録画の最初・途中・最後のコマをAIが見て、何をするものか伝わるかを確かめます。ねらいが「広がる」の案件は、初めて公開したときに自動で作ります。ほかの動画を作っている途中なら、終わってから作ります。投稿は、動画を保存して、投稿文の案と一緒に手で行ってください。
      </p>
      <BusyNote busy={busy} error={error} />
      {accepted && !busy && <p className="text-sm text-ink-2" role="status">受け付けました。裏で作ります（1〜2分ほど。ほかの動画を作っている途中なら、そのあと）。できたら、画面を読み込み直すとここに出ます。</p>}
      {videos.length === 0 ? (
        <p className="text-sm text-ink-2">まだありません。</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {videos.map((v) => {
            const text = [v.caption, link].filter(Boolean).join("\n");
            return (
              <li key={v.id} className="space-y-2">
                <video src={`/api/videos/${v.file}`} controls playsInline preload="metadata" className="w-full max-w-[240px] rounded-lg border border-line bg-black" />
                <div className="text-sm font-medium">{v.hook}</div>
                <div className="text-xs text-muted">第{v.version}版・{v.at}</div>
                {!v.ok && v.issues.length > 0 && (
                  <ul className="list-disc pl-5 text-xs" style={{ color: "var(--warning)" }}>
                    {v.issues.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                )}
                {v.caption && <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs">{text}</p>}
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/videos/${v.file}`} download={v.file} data-demo-ok className="rounded-lg border border-line px-3 py-1.5 text-sm">動画を保存</a>
                  {v.caption && (
                    <button type="button" data-demo-ok onClick={() => navigator.clipboard.writeText(text).catch(() => {})} className="rounded-lg border border-line px-3 py-1.5 text-sm">
                      投稿文をコピー
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
