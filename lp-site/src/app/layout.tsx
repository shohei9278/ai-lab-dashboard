import type { Metadata } from "next";
import Link from "next/link";
import { M_PLUS_Rounded_1c, Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";
import Script from "next/script";
import { GA_MEASUREMENT_ID, SITE_NAME, SITE_URL } from "@/lib/site";
import { ExcludedNotice } from "./ExcludedNotice";
import "./globals.css";

const noto = Noto_Sans_JP({ variable: "--font-noto", subsets: ["latin"], weight: ["400", "500", "700"] });
// LPの書体の選択肢（丸ゴシック・明朝）。使うLPでだけ読み込まれるよう、先読みはしない
const rounded = M_PLUS_Rounded_1c({ variable: "--font-rounded", subsets: ["latin"], weight: ["400", "700"], preload: false });
const mincho = Noto_Serif_JP({ variable: "--font-mincho", subsets: ["latin"], weight: ["400", "700"], preload: false });

// シェア画像などのURLを絶対URLにするための基準（Vercel が本番のドメインを渡してくれる）
const base = SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(base),
  title: SITE_NAME,
  description: `${SITE_NAME} の、登録なしで使える小さなWebツールと、作るかどうかを確かめているサービスのページです。`,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${noto.variable} ${rounded.variable} ${mincho.variable} antialiased`}>
        {GA_MEASUREMENT_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
            <Script id="ga" strategy="afterInteractive">
              {/* 運営者のブラウザ（?me=1 で印を付けたもの）では、GA に何も送らない */}
              {`try{var m=new URLSearchParams(location.search).get('me');if(m==='1')localStorage.setItem('lp_exclude_me','1');if(m==='0')localStorage.removeItem('lp_exclude_me');if(localStorage.getItem('lp_exclude_me')==='1')window['ga-disable-${GA_MEASUREMENT_ID}']=true;}catch(e){}
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_MEASUREMENT_ID}');`}
            </Script>
          </>
        )}
        <ExcludedNotice />
        {children}
        <footer className="border-t border-line px-4 py-6 text-center text-xs text-muted">
          運営: {SITE_NAME}・<Link href="/privacy" className="underline">プライバシーポリシー</Link>
        </footer>
      </body>
    </html>
  );
}
