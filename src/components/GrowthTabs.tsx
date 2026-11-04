import Link from "next/link";

// 「集客」のページの切り替え
const TABS = [
  { href: "/growth", label: "SNSの管理" },
  { href: "/growth/plan", label: "集客の作戦" },
];

export function GrowthTabs({ current }: { current: string }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-line" aria-label="集客のページ">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.href === current ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
