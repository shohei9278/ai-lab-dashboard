"use client";

import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";

// LPの見出しの横に置く、AIが描いたイラスト
export function IllustrationControls({ id, url, isPublic }: { id: number; url: string | null; isPublic: boolean }) {
  const { run, busy, error } = useLoopAction();
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="text-xs text-muted">
        AIが描いたイラスト{isPublic ? "（描き直す・外すと、公開中のページにもすぐ反映されます）" : ""}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="LPのイラスト" className="h-32 w-auto rounded-lg border border-line" />
        ) : (
          <div className="flex h-32 w-48 items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">イラストなし</div>
        )}
        <div className="flex flex-col gap-2">
          <ActionButton disabled={!!busy} onClick={() => run("AIがイラストを描いています（30秒ほど）…", { action: "illustration", projectId: id, mode: "redraw" })}>
            {url ? "描き直す（約12円）" : "イラストを描く（約12円）"}
          </ActionButton>
          {url && (
            <ActionButton disabled={!!busy} onClick={() => run("外しています…", { action: "illustration", projectId: id, mode: "remove" })}>
              イラストを外す
            </ActionButton>
          )}
        </div>
      </div>
      <BusyNote busy={busy} error={error} />
    </div>
  );
}
