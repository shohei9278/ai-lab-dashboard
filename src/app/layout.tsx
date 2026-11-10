import { openRequests } from "@/lib/plan";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { pendingCount } from "@/lib/views";
import { ActivityBadge } from "@/components/ActivityBadge";
import { SideNav, type NavGroup } from "@/components/SideNav";
import { GuestGuard } from "@/components/GuestGuard";
import { isOwner } from "@/lib/viewer";
import { LogoutButton } from "./login/LoginForm";
import "./globals.css";

// フォントはブラウザが Google Fonts から読み込む（next/font はビルドのときに取りに行くので、ビルド環境によって失敗するため）
const FONT_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=M+PLUS+Rounded+1c:wght@400;700&family=Noto+Serif+JP:wght@400;700&display=swap";
const FONT_VARS = { "--font-noto": "'Noto Sans JP'", "--font-rounded": "'M PLUS Rounded 1c'", "--font-mincho": "'Noto Serif JP'" } as React.CSSProperties;
const fontHead = (
  <head>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link rel="stylesheet" href={FONT_URL} />
  </head>
);

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
        {fontHead}
        <body className="antialiased" style={FONT_VARS}>
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </body>
      </html>
    );
  }
  const pending = pendingCount();
  const proposals = openRequests().filter((r) => r.source !== "human").length;
  const owner = await isOwner();
  const loginEnabled = !!process.env.DASHBOARD_PASSWORD;
  const groups: NavGroup[] = [
    { items: [{ href: "/", label: "ホーム", also: ["/plan"] }, { href: "/projects", label: "案件の一覧" }, { href: "/live", label: "ライブ" }] },
    { title: "あなたの確認", items: [{ href: "/approvals", label: "判断待ち", badge: pending }, { href: "/proposals", label: "提案箱", badge: proposals }] },
    { title: "AIの社員", items: [{ href: "/meetings", label: "会議室" }, { href: "/diary", label: "日報", also: ["/voices"] }, { href: "/lab", label: "AIの成績" }] },
    { title: "届ける", items: [{ href: "/growth", label: "集客", also: ["/viral"] }, { href: "/outside", label: "外の声" }] },
    { title: "その他", items: [{ href: "/interventions", label: "人の手の記録" }, { href: "/notes", label: "資料", also: ["/reports"] }, { href: "/settings", label: "設定" }] },
  ];
  return (
    <html lang="ja">
      {fontHead}
      <body className="antialiased" style={FONT_VARS}>
        <div className="lg:flex">
          <SideNav
            groups={groups}
            footer={owner ? (loginEnabled ? <LogoutButton /> : null) : <Link href="/login" className="text-muted underline">運営者のログイン</Link>}
          />
          <div className="min-w-0 flex-1">
          {!owner && (
            <div className="border-b border-line bg-surface-2">
              <p className="px-4 py-1.5 lg:px-6 text-xs text-ink-2">
                公開中のデモです。AIが実際に動かしている実験の、本物の画面と数字を見られます（閲覧のみ。ボタンは押せません。個人の情報や他人の投稿は伏せています）。
              {" "}<Link href="/showcase" className="underline">はじめての方は概要ページへ</Link>
              </p>
            </div>
          )}
            <main className="mx-auto max-w-6xl px-4 py-6 lg:px-6">{children}</main>
          </div>
        </div>
        <ActivityBadge />
        {!owner && <GuestGuard />}
      </body>
    </html>
  );
}
