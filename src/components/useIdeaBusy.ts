"use client";

import { useEffect, useState } from "react";

// いま動いているアイデア出しの名前（なければ null）。アイデア出しのボタンを、動いている間は押せなくするために数秒ごとに確かめる
export function useIdeaBusy(): string | null {
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      if (document.hidden) return;
      const res = await fetch("/api/activity", { cache: "no-store" }).catch(() => null);
      const data = res?.ok ? ((await res.json().catch(() => null)) as { ideaBusy?: string | null } | null) : null;
      if (!stop && data) setBusy(data.ideaBusy ?? null);
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return busy;
}
