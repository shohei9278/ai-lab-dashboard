import type { Metadata } from "next";
import Link from "next/link";
import { Noto_Sans_JP } from "next/font/google";
import Script from "next/script";
import { GA_MEASUREMENT_ID, SITE_NAME } from "@/lib/site";
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
        {GA_MEASUREMENT_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
            <Script id="ga" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_MEASUREMENT_ID}');`}
            </Script>
          </>
        )}
        {children}
        <footer className="border-t border-line px-4 py-6 text-center text-xs text-muted">
          運営: {SITE_NAME}・<Link href="/privacy" className="underline">プライバシーポリシー</Link>
        </footer>
      </body>
    </html>
  );
}
