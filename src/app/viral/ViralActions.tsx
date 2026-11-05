"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const post = (body: unknown) => fetch("/api/viral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function DeleteViral({ id }: { id: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="underline"
      onClick={async () => {
        if (!confirm("この投稿を消しますか？")) return;
        await post({ deleteId: id });
        router.refresh();
      }}
    >
      消す
    </button>
  );
}

// ブックマークバーに置くボタン（React は javascript: のリンクを書けないので、HTMLとして入れる）
export function ViralBookmarklet() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  if (!origin) return null;
  const code = `javascript:(()=>{window.open('${origin}/viral/add?url='+encodeURIComponent(location.href),'ailabviral','width=440,height=280')})()`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        dangerouslySetInnerHTML={{ __html: `<a href="${code.replace(/"/g, "&quot;")}" class="inline-block rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink" onclick="alert('ブックマークバーにドラッグして置いてください');return false;">話題の投稿に追加</a>` }}
      />
      <span className="text-xs text-muted">← これをブックマークバーへドラッグ</span>
    </div>
  );
}

// URLを貼る（1行に1つ）
export function AddViral() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-1 border-t border-line pt-3">
      <div className="text-xs text-muted">または、Xの投稿のURLを貼る（1行に1つ）</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="block w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" placeholder="https://x.com/.../status/..." />
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          disabled={!text.trim()}
          className="rounded-lg border border-line px-3 py-1 disabled:opacity-50"
          onClick={async () => {
            const res = await post({ urls: text.split(/\s+/) });
            const data = await res.json().catch(() => ({}));
            setMsg(res.ok ? (data.added ? `${data.added}件を受け付けました` : "新しく追加できる投稿はありませんでした（Xの投稿のURLか、もう入っていないか確かめてください）") : data.error ?? "受け付けられませんでした");
            if (res.ok) { setText(""); router.refresh(); }
          }}
        >
          取り込む
        </button>
        {msg && <span className="text-ink-2">{msg}</span>}
      </div>
    </div>
  );
}

// 週1回の検索の設定と、今すぐ検索するボタン
export function SearchControls({ enabled, count, wantsCount, ready }: { enabled: boolean; count: number; wantsCount: number; ready: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [n, setN] = useState(count);
  const [w, setW] = useState(wantsCount);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (patch: Record<string, unknown>) => {
    await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    router.refresh();
  };
  const yen = Math.round((n + w) * 0.005 * 150);
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} disabled={!ready} onChange={(e) => { setOn(e.target.checked); void save({ viralSearch: e.target.checked }); }} />
        週1回、自動で検索する
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-2">
        1回に読む投稿
        <select value={n} disabled={!ready} onChange={(e) => { const v = Number(e.target.value); setN(v); void save({ viralSearchCount: v }); }} className="rounded-lg border border-line bg-surface px-2 py-1">
          {[100, 200, 300, 500].map((x) => <option key={x} value={x}>{x}件（約{Math.round(x * 0.005 * 150)}円）</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-2">
        「欲しい」の声を読む数
        <select value={w} disabled={!ready} onChange={(e) => { const v = Number(e.target.value); setW(v); void save({ wantsSearchCount: v }); }} className="rounded-lg border border-line bg-surface px-2 py-1">
          {[0, 100, 200, 300].map((x) => <option key={x} value={x}>{x ? `${x}件（約${Math.round(x * 0.005 * 150)}円）` : "探さない"}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          disabled={!ready || busy}
          className="rounded-lg border border-line px-3 py-1 disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            const res = await post({ action: "search" });
            const data = await res.json().catch(() => ({}));
            setBusy(false);
            setMsg(res.ok ? `${data.read}件を読み、話題の投稿を${data.added}件・「欲しい」の声を${data.wants}件取り込みました${data.wantsError ? `（声の検索は失敗: ${data.wantsError}）` : ""}` : data.error ?? "検索できませんでした");
            router.refresh();
          }}
        >
          {busy ? "検索しています…" : `今すぐ検索する（約${yen}円）`}
        </button>
        {msg && <span className="text-ink-2">{msg}</span>}
      </div>
    </div>
  );
}

export function DeleteWant({ id }: { id: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="underline"
      onClick={async () => {
        if (!confirm("この声をアイデア出しに使わないようにしますか？")) return;
        await post({ deleteWantId: id });
        router.refresh();
      }}
    >
      外す
    </button>
  );
}
