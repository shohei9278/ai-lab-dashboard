"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshTrends() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="text-right">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const res = await fetch("/api/trends", { method: "POST" }).catch(() => null);
          const data = res ? await res.json().catch(() => ({})) : {};
          setBusy(false);
          if (data.errors?.length) setMsg(`一部取れませんでした: ${data.errors.join(" / ")}`);
          router.refresh();
        }}
        className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {busy ? "取得しています…" : "今すぐ取り直す"}
      </button>
      {msg && <p className="mt-1 text-xs" style={{ color: "var(--critical)" }}>{msg}</p>}
    </div>
  );
}
