"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Item = { key: string; title: string; detail: string; since: number };

// どのページの上にも出す「AIが作業中」の表示。ページを移っても、裏で続いている作業が分かるように
export function ActivityBadge() {
  const [items, setItems] = useState<Item[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const prev = useRef(new Map<string, string>());

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      if (document.hidden) return;
      const res = await fetch("/api/activity", { cache: "no-store" }).catch(() => null);
      const data = res?.ok ? ((await res.json().catch(() => null)) as { items: Item[] } | null) : null;
      if (stop || !data) return;
      // さっきまであって、今はないもの＝終わった作業。少しの間「終わりました」と出す
      const ended = [...prev.current.entries()].filter(([k]) => !data.items.some((i) => i.key === k)).map(([, t]) => t);
      if (ended.length) {
        setDone(ended);
        setTimeout(() => setDone([]), 8000);
      }
      prev.current = new Map(data.items.map((i) => [i.key, i.title]));
      setItems(data.items);
    };
    poll();
    const p = setInterval(poll, 3000);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { stop = true; clearInterval(p); clearInterval(t); };
  }, []);

  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  if (!items.length && !done.length) return null;
  return (
    <Link href="/live" className="ml-auto flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs hover:bg-surface-2" style={{ borderColor: items.length ? "var(--accent)" : "var(--good)" }} title="ライブ画面で見る">
      <style>{`@keyframes lab-badge { 0%,100% { opacity: 1 } 50% { opacity: .3 } } .lab-badge { animation: lab-badge 1.4s ease-in-out infinite } @media (prefers-reduced-motion: reduce) { .lab-badge { animation: none } }`}</style>
      {items.length ? (
        <>
          <span aria-hidden className="lab-badge inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
          <span className="truncate">
            <b>AIが作業中</b>：{items[0].title}
            <span className="text-ink-2">（{items[0].detail}）</span>
            {items.length > 1 && <span className="text-ink-2"> ほか{items.length - 1}件</span>}
          </span>
          <span className="num shrink-0 text-muted">{mmss(now - items[0].since)}</span>
        </>
      ) : (
        <span style={{ color: "var(--good)" }}>✓ 終わりました：{done.join("、")}</span>
      )}
    </Link>
  );
}
