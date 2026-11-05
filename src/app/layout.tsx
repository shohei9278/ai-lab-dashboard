import type { Metadata } from "next";
import Link from "next/link";
import { M_PLUS_Rounded_1c, Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";
import { headers } from "next/headers";
import { pendingCount } from "@/lib/views";
import { ActivityBadge } from "@/components/ActivityBadge";
import "./globals.css";

const noto = Noto_Sans_JP({ variable: "--font-noto", subsets: ["latin"], weight: ["400", "500", "700"] });
// LPの書体の選択肢（丸ゴシック・明朝）。使うLPでだけ読み込まれるよう、先読みはしない
const rounded = M_PLUS_Rounded_1c({ variable: "--font-rounded", subsets: ["latin"], weight: ["400", "700"], preload: false });
const mincho = Noto_Serif_JP({ variable: "--font-mincho", subsets: ["latin"], weight: ["400", "700"], preload: false });

export const metadata: Metadata = {
  title: "AI Product Lab",
  description: "AIが自動でプロダクトを作って改善する実験のダッシュボード",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 公開ページ（/showcase）では、ダッシュボードのメニューや承認待ちの数を出さない
  if ((await headers()).get("x-pathname") === "/showcase") {
    return (
      <html lang="ja">
        <body className={`${noto.variable} ${rounded.variable} ${mincho.variable} antialiased`}>
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </body>
      </html>
    );
  }
  const pending = pendingCount();
  const nav = [
    { href: "/", label: "ホーム" },
    { href: "/live", label: "ライブ" },
    { href: "/approvals", label: "判断待ち", badge: pending },
    { href: "/growth", label: "集客" },
    { href: "/lab", label: "実験結果" },
    { href: "/settings", label: "設定" },
  ];
  return (
    <html lang="ja">
      <body className={`${noto.variable} ${rounded.variable} ${mincho.variable} antialiased`}>
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
            <ActivityBadge />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
