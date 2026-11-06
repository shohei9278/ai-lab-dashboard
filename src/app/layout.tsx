import { openRequests } from "@/lib/plan";
import type { Metadata } from "next";
import Link from "next/link";
import { M_PLUS_Rounded_1c, Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";
import { headers } from "next/headers";
import { pendingCount } from "@/lib/views";
import { ActivityBadge } from "@/components/ActivityBadge";
import { GuestGuard } from "@/components/GuestGuard";
import { isOwner } from "@/lib/viewer";
import { LogoutButton } from "./login/LoginForm";
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
  const proposals = openRequests().filter((r) => r.source !== "human").length;
  const owner = await isOwner();
  const loginEnabled = !!process.env.DASHBOARD_PASSWORD;
  const nav = [
    { href: "/", label: "ホーム" },
    { href: "/live", label: "ライブ" },
    { href: "/meetings", label: "会議室" },
    { href: "/approvals", label: "判断待ち", badge: pending },
    { href: "/proposals", label: "提案箱", badge: proposals },
    { href: "/lab", label: "AIの成績" },
    { href: "/outside", label: "外の声" },
    { href: "/growth", label: "集客" },
    { href: "/notes", label: "資料" },
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
            <span className="ml-auto text-xs">
              {owner ? (loginEnabled && <LogoutButton />) : <Link href="/login" className="text-muted underline">運営者のログイン</Link>}
            </span>
          </div>
          {!owner && (
            <div className="border-t border-line bg-surface-2">
              <p className="mx-auto max-w-6xl px-4 py-1.5 text-xs text-ink-2">
                公開中のデモです。AIが実際に動かしている実験の、本物の画面と数字を見られます（閲覧のみ。ボタンは押せません。個人の情報や他人の投稿は伏せています）。
              </p>
            </div>
          )}
        </header>
        {!owner && <GuestGuard />}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
