import Link from "next/link";

// ページの上のタブ（まとめたページの切り替え）
function PageTabs({ tabs, current, label }: { tabs: { href: string; label: string }[]; current: string; label: string }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-line" aria-label={label}>
      {tabs.map((t) => (
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

// AIの成績
export function LabTabs({ current }: { current: string }) {
  return <PageTabs current={current} label="AIの成績のページ" tabs={[{ href: "/lab", label: "AIの成績" }, { href: "/lab/tests", label: "基礎テスト" }]} />;
}

// 資料
export function LibraryTabs({ current }: { current: string }) {
  return <PageTabs current={current} label="資料のページ" tabs={[{ href: "/notes", label: "社内の知見" }, { href: "/reports", label: "発信の下書き" }]} />;
}

// 集客
export function GrowthTabs({ current }: { current: string }) {
  return <PageTabs current={current} label="集客のページ" tabs={[{ href: "/growth", label: "SNSの投稿" }, { href: "/growth/stats", label: "効いた手" }, { href: "/viral", label: "話題の投稿" }]} />;
}

// 日報とつぶやき
export function DiaryTabs({ current }: { current: string }) {
  return <PageTabs current={current} label="日報とつぶやきのページ" tabs={[{ href: "/diary", label: "日報" }, { href: "/voices", label: "つぶやき" }]} />;
}
