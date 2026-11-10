"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Item = { href: string; label: string; badge?: number; also?: string[] };
export type NavGroup = { title?: string; items: Item[] };

const isActive = (path: string, item: Item) =>
  [item.href, ...(item.also ?? [])].some((h) => (h === "/" ? path === "/" : path === h || path.startsWith(`${h}/`)));

// 左のサイドバー。スマホでは上のメニューボタンで開く
export function SideNav({ groups, footer }: { groups: NavGroup[]; footer: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const total = groups.flatMap((g) => g.items).reduce((n, i) => n + (i.badge ?? 0), 0);
  return (
    <aside className="z-30 shrink-0 border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-52 lg:flex-col lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="font-bold">AI Product Lab</Link>
        <button
          type="button" data-demo-ok aria-expanded={open} aria-controls="side-nav"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-sm lg:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "閉じる" : "メニュー"}
          {!open && total > 0 && <span className="num rounded-full bg-accent px-1.5 text-xs text-accent-ink">{total}</span>}
        </button>
      </div>
      <div id="side-nav" className={`${open ? "block" : "hidden"} border-t border-line lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:border-t-0`}>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2 text-sm" aria-label="メニュー">
          {groups.map((g, i) => (
            <div key={g.title ?? i}>
              {g.title && <div className="px-2 pb-1 text-xs text-muted">{g.title}</div>}
              <ul className="space-y-0.5">
                {g.items.map((n) => {
                  const active = isActive(path, n);
                  return (
                    <li key={n.href}>
                      <Link
                        href={n.href} aria-current={active ? "page" : undefined}
                        className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
                      >
                        {n.label}
                        {n.badge ? <span className="num rounded-full bg-accent px-1.5 text-xs text-accent-ink" aria-label={`${n.badge}件`}>{n.badge}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-line px-4 py-3 text-xs">{footer}</div>
      </div>
    </aside>
  );
}
