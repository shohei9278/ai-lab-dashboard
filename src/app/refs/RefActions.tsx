"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function RefActions({ id }: { id: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="underline"
      onClick={async () => {
        if (!confirm("この参考を消しますか？")) return;
        await fetch("/api/refs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deleteId: id }) });
        router.refresh();
      }}
    >
      消す
    </button>
  );
}

// ブックマークバーに置くボタン（React は javascript: のリンクを書けないので、HTMLとして入れる）
export function Bookmarklet() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  if (!origin) return null;
  const code = `javascript:(()=>{window.open('${origin}/refs/add?url='+encodeURIComponent(location.href),'ailabref','width=440,height=280')})()`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        dangerouslySetInnerHTML={{ __html: `<a href="${code.replace(/"/g, "&quot;")}" class="inline-block rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink" onclick="alert('ブックマークバーにドラッグして置いてください');return false;">参考に追加</a>` }}
      />
      <span className="text-xs text-muted">← これをブックマークバーへドラッグ</span>
    </div>
  );
}

// URLをまとめて貼る
export function BulkAdd() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-1 border-t border-line pt-3">
      <div className="text-xs text-muted">または、URLをまとめて貼る（1行に1つ）</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="block w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" placeholder="https://..." />
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          disabled={!text.trim()}
          className="rounded-lg border border-line px-3 py-1 disabled:opacity-50"
          onClick={async () => {
            const res = await fetch("/api/refs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: text.split(/\s+/) }) });
            const data = await res.json().catch(() => ({}));
            setMsg(res.ok ? `${data.added}件を受け付けました` : data.error ?? "受け付けられませんでした");
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
