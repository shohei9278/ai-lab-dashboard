import type { Metadata } from "next";
import Link from "next/link";
import { Noto_Sans_JP } from "next/font/google";
import { pendingCount } from "@/lib/views";
import "./globals.css";

const noto = Noto_Sans_JP({ variable: "--font-noto", subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "AI Product Lab",
  description: "AIが自動でプロダクトを作って改善する実験のダッシュボード",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pending = pendingCount();
  const nav = [
    { href: "/", label: "ホーム" },
    { href: "/approvals", label: "承認待ち", badge: pending },
    { href: "/lab", label: "AIの使い分け" },
    { href: "/notes", label: "実験メモ" },
    { href: "/settings", label: "設定" },
  ];
  return (
    <html lang="ja">
      <body className={`${noto.variable} antialiased`}>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-bold">AI Product Lab</Link>
            <nav className="flex flex-wrap gap-4 text-sm text-ink-2">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="inline-flex items-center gap-1 hover:text-ink">
                  {n.label}
                  {n.badge ? (
                    <span className="num rounded-full bg-accent px-1.5 text-xs text-accent-ink" aria-label={`${n.badge}件`}>{n.badge}</span>
                  ) : null}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
