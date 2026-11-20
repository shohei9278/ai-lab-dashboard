import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { CHECK_TOOL_HTML } from "@/lp/inAppCheck";
import { ShortToolView } from "@/lp/ShortToolView";
import { ToolFrame } from "@/lp/ToolFrame";
import { SITE_NAME } from "@/lib/site";
import { InAppPanel } from "./InAppPanel";
import { ResultSheet } from "../[slug]/ResultSheet";

// アプリの中のブラウザ（X・Instagram・LINE など）での見え方を確かめるページ（運営者の依頼。#72 を X から開くと、下の「ふる」が帯に隠れた）
// - 本物の遊びのツールのページ（ShortToolView の play・画面に固定した枠・低い画面では縮めて収める）と同じ作りに、試しのツールを入れる
// - 見分け（inApp.ts の data-inapp）が効いたか、画面の高さ、ブラウザの名乗りなどを画面の上に出し、画面の下の端からの目盛りを引く
// - 検索やサイトの一覧には出さない（URL を知っている人だけが開く）。数を数えない（Tracker を置かない）
export const metadata: Metadata = {
  title: `アプリの中のブラウザの確かめ｜${SITE_NAME}`,
  robots: { index: false, follow: false },
};

// このページだけ、画面の端までを使う設定（viewport-fit=cover）にする。iPhone が安全な余白を env(safe-area-inset-*) で知らせるので、
// X がページを上の帯の分だけ下にずらしている量（JavaScript の値にはどれも出なかった）を、そこで測れるかを確かめる
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function InAppCheck() {
  return (
    <main>
      <ShortToolView
        play
        home={<Link href="/">{SITE_NAME}</Link>}
        title="アプリの中のブラウザの確かめ"
        lead="X・Instagram・LINE などのアプリから開いて、下の「ふる」がアプリの帯に隠れないか、右と左の目盛りでどこまで重なるかを見るためのページです。"
        menu={
          // 本物の遊ぶ画面と同じメニューの欄（ResultSheet の menu）。シェアの記録やひとことが本物の案件に混ざらないよう、ひとことは置かない
          <ResultSheet
            slug="inapp-check"
            version={0}
            shareText="アプリの中のブラウザの確かめ"
            others={[]}
            menu={{
              label: "メニュー",
              home: (
                <>
                  <Link href="/" className="underline">{SITE_NAME} のほかのツールを見る</Link>
                  {" ・ "}
                  <Link href="/privacy" className="underline">プライバシーポリシー</Link>
                </>
              ),
            }}
          />
        }
        tool={<ToolFrame html={CHECK_TOOL_HTML} title="確かめ用のツール" fill fit />}
      />
      <InAppPanel />
    </main>
  );
}
