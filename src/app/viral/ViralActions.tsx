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

// アイデアを出す日の検索の設定と、今すぐ検索するボタン（件数は検索1つあたり。1回の費用は 検索の数 × 件数 で決まる）
export function SearchControls({ enabled, perQuery, wantsPerQuery, viralQueries, wantQueries, ready }: {
  enabled: boolean; perQuery: number; wantsPerQuery: number; viralQueries: number; wantQueries: number; ready: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [n, setN] = useState(perQuery);
  const [w, setW] = useState(wantsPerQuery);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (patch: Record<string, unknown>) => {
    await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    router.refresh();
  };
  const yenOf = (posts: number) => Math.round(posts * 0.005 * 150);
  const yen = yenOf(viralQueries * n + (w > 0 ? wantQueries * w : 0));
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} disabled={!ready} onChange={(e) => { setOn(e.target.checked); void save({ viralSearch: e.target.checked }); }} />
        アイデアを出す日に、まだ検索していなければ自動で検索する（1日1回まで。1回 約{yen}円・月に毎日なら約{yen * 30}円）
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-2">
        話題の投稿を、検索1つ（{viralQueries}種類）あたり
        <select value={n} disabled={!ready} onChange={(e) => { const v = Number(e.target.value); setN(v); void save({ viralPerQuery: v }); }} className="rounded-lg border border-line bg-surface px-2 py-1">
          {[10, 20, 30, 50, 100].map((x) => <option key={x} value={x}>{x}件（{viralQueries * x}件・約{yenOf(viralQueries * x)}円）</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-2">
        「欲しい」の声を、検索1つ（{wantQueries}種類）あたり
        <select value={w} disabled={!ready} onChange={(e) => { const v = Number(e.target.value); setW(v); void save({ wantsPerQuery: v }); }} className="rounded-lg border border-line bg-surface px-2 py-1">
          {[0, 10, 20, 30, 50].map((x) => <option key={x} value={x}>{x ? `${x}件（${wantQueries * x}件・約${yenOf(wantQueries * x)}円）` : "探さない"}</option>)}
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
