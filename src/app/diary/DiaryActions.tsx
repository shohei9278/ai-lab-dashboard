"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 今日の日報を今すぐ書く
export function WriteDiary({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/diary", { method: "POST" });
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setBusy(false);
          if (!res.ok) setError(data.error ?? "書けませんでした");
          router.refresh();
        }}
      >
        {busy ? "AIが書いています（1分ほど）…" : label}
      </button>
      {error && <span className="text-xs" style={{ color: "var(--critical)" }}>{error}</span>}
    </span>
  );
}

// note の下書きをコピーする
export function CopyNote({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "コピーしました" : "全文をコピー"}
    </button>
  );
}
