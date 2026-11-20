import type { Metadata } from "next";
import Link from "next/link";
import { CHECK_TOOL_HTML } from "@/lp/inAppCheck";
import { ShortToolView } from "@/lp/ShortToolView";
import { ToolFrame } from "@/lp/ToolFrame";
import { SITE_NAME } from "@/lib/site";
import { InAppPanel } from "./InAppPanel";

// アプリの中のブラウザ（X・Instagram・LINE など）での見え方を確かめるページ（運営者の依頼。#72 を X から開くと、下の「ふる」が帯に隠れた）
// - 本物の遊びのツールのページ（ShortToolView と全画面の枠）と同じ作りに、試しのツールを入れる
// - 見分け（inApp.ts の data-inapp）が効いたか、画面の高さ、ブラウザの名乗りなどを画面の上に出し、画面の下の端からの目盛りを引く
// - 検索やサイトの一覧には出さない（URL を知っている人だけが開く）。数を数えない（Tracker を置かない）
export const metadata: Metadata = {
  title: `アプリの中のブラウザの確かめ｜${SITE_NAME}`,
  robots: { index: false, follow: false },
};

export default function InAppCheck() {
  return (
    <main>
      <ShortToolView
        title="アプリの中のブラウザの確かめ"
        lead="X・Instagram・LINE などのアプリから開いて、下の「ふる」がアプリの帯に隠れないか、右と左の目盛りでどこまで重なるかを見るためのページです。"
        home={<Link href="/">{SITE_NAME}</Link>}
        tool={<ToolFrame html={CHECK_TOOL_HTML} title="確かめ用のツール" fill />}
      />
      <InAppPanel />
    </main>
  );
}
