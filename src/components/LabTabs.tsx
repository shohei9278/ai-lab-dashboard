import Link from "next/link";

// 「実験結果」にまとめたページの切り替え
const TABS = [
  { href: "/lab", label: "結果とランキング" },
  { href: "/notes", label: "実験メモ" },
  { href: "/reports", label: "週のレポート" },
  { href: "/lab/tests", label: "基礎テスト" },
];

export function LabTabs({ current }: { current: string }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-line" aria-label="実験結果のページ">
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
