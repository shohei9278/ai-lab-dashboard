import { openRequests } from "@/lib/plan";
import type { Metadata } from "next";
import Link from "next/link";
import { pendingCount } from "@/lib/views";
import { ActivityBadge } from "@/components/ActivityBadge";
import { AppShell } from "@/components/AppShell";
import { SideNav, type NavGroup } from "@/components/SideNav";
import { GuestGuard } from "@/components/GuestGuard";
import { isOwner } from "@/lib/viewer";
import { LogoutButton } from "./login/LoginForm";
import "./globals.css";

// フォントは端末やサーバーに入っているものを使う（外部から読み込まないので、閲覧者の情報を送らず、ビルドも止まらない）
const FONT_VARS = {
  "--font-noto": "'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans'",
  "--font-rounded": "'Hiragino Maru Gothic ProN', 'Noto Sans CJK JP'",
  "--font-mincho": "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif CJK JP'",
} as React.CSSProperties;

export const metadata: Metadata = {
  title: "AI Product Lab",
  description: "AIが自動でプロダクトを作って改善する実験のダッシュボード",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pending = pendingCount();
  const proposals = openRequests().filter((r) => r.source !== "human").length;
  const owner = await isOwner();
  const loginEnabled = !!process.env.DASHBOARD_PASSWORD;
  // 毎日見るものを上に。来訪者には「あなた」ではなく「運営者」と出す
  const groups: NavGroup[] = [
    { title: "今日の運営", items: [{ href: "/", label: "ホーム" }, { href: "/plan", label: "毎日の計画" }, { href: "/approvals", label: "判断待ち", badge: owner ? pending : 0 }, { href: "/proposals", label: "提案箱", badge: owner ? proposals : 0 }] },
    { title: "案件と集客", items: [{ href: "/projects", label: "案件の一覧" }, { href: "/growth", label: "集客", also: ["/viral"] }, { href: "/outside", label: "外の声" }] },
    { title: "AIの社員", items: [{ href: "/live", label: "ライブ" }, { href: "/meetings", label: "会議室" }, { href: "/diary", label: "日報", also: ["/voices"] }, { href: "/lab", label: "AIの成績" }] },
    { title: "記録と設定", items: [{ href: "/interventions", label: "人の手の記録" }, { href: "/notes", label: "資料", also: ["/reports"] }, ...(owner ? [{ href: "/traces", label: "AIの入出力" }] : []), { href: "/settings", label: "設定" }] },
  ];
  return (
    <html lang="ja">
      <body className="antialiased" style={FONT_VARS}>
        <AppShell
          nav={
            <SideNav
              groups={groups}
              footer={owner ? (loginEnabled ? <LogoutButton /> : null) : <Link href="/login" className="text-muted underline">運営者のログイン</Link>}
            />
          }
          banner={!owner && (
            <div className="border-b border-line bg-surface-2">
              <p className="px-4 py-1.5 lg:px-6 text-xs text-ink-2">
                公開中のデモです（閲覧のみ）<span className="hidden sm:inline">。AIが実際に動かしている実験の、本物の画面と数字を見られます。ボタンは押せません。個人の情報や他人の投稿は伏せています</span>。
              {" "}<Link href="/showcase" className="underline">はじめての方は概要ページへ</Link>
              </p>
            </div>
          )}
          overlay={<><ActivityBadge />{!owner && <GuestGuard />}</>}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
