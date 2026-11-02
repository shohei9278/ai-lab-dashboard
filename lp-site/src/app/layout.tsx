import type { Metadata } from "next";
import Link from "next/link";
import { Noto_Sans_JP } from "next/font/google";
import { SITE_NAME } from "@/lib/site";
import "./globals.css";

const noto = Noto_Sans_JP({ variable: "--font-noto", subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: SITE_NAME,
  description: `${SITE_NAME} が準備中のサービスの、事前登録ページです。`,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${noto.variable} antialiased`}>
        {children}
        <footer className="border-t border-line px-4 py-6 text-center text-xs text-muted">
          運営: {SITE_NAME}・<Link href="/privacy" className="underline">プライバシーポリシー</Link>
        </footer>
      </body>
    </html>
  );
}
