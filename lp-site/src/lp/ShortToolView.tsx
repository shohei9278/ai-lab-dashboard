import type { ReactNode } from "react";

// 遊び・毎日のお題など（ねらいが「広がる」「また来てもらう」）のツールの、短いページ（content.ts の short）
// - 紹介ページ（悩み・手順・称号の一覧など）は作らない。触れば分かり、説明はネタばらしになりやすく、読まれないため
// - 開いたらすぐ遊べるよう、細い上の帯（サイト名・ツール名）の下を、ツールが画面の高さいっぱいに使う（運営者の依頼。ゲームのサイトのように没頭できるように）
//   ページがスクロールして操作とぶつからないよう、枠の高さは画面に合わせて決める（中身が長ければ、枠の中でスクロールする）
// - 一行の説明とシェアの欄は、ツールの下に置く（検索・シェアのための文は残す）
// - 運営者名とプライバシーポリシーは、サイト全体の下の欄に出る
// ツールの下のシェアの欄の見出し（公開サイトとダッシュボードのプレビュー、結果のあとの欄で同じ文にする）
export const SHORT_SHARE_HEADING = "楽しかったら、シェアしてもらえるとうれしいです";
// ツールの枠の高さ（画面の高さから、上の帯の高さ h-11 と、SNS のアプリの中のブラウザの下の帯の目安 --lab-inapp-pad を引いたもの。inApp.ts）
export const SHORT_FRAME_HEIGHT = "calc(100dvh - 2.75rem - var(--lab-inapp-pad, 0px))";

// home: 上の帯の左に出す、サイトの入口へのリンク（プレビューでは押せないもの）
// barEnd: 上の帯の右に出すもの（結果が出たあとの「シェア・ほかの遊び」のボタン）
// frameHeight: ツールの枠の高さ（プレビューでは、画面の高さの代わりに決まった高さにする）
export function ShortToolView({ title, lead, tool, after, home, barEnd, frameHeight = SHORT_FRAME_HEIGHT }: { title: string; lead: string; tool: ReactNode; after?: ReactNode; home?: ReactNode; barEnd?: ReactNode; frameHeight?: string }) {
  return (
    <div>
      <header className="flex h-11 items-center gap-3 border-b border-[color:var(--border)] px-4">
        {home && <div className="shrink-0 text-sm font-bold">{home}</div>}
        <h1 className="min-w-0 flex-1 truncate text-sm text-ink-2">{title}</h1>
        {barEnd && <div className="shrink-0">{barEnd}</div>}
      </header>
      <section id="tool" data-section="tool" style={{ height: frameHeight }} className="mx-auto max-w-3xl border-[color:var(--border)] bg-[color:var(--bg)] sm:border-x">
        {tool}
      </section>
      {lead && <p className="mx-auto max-w-md px-6 pt-8 text-center text-sm text-ink-2">{lead}</p>}
      {after}
    </div>
  );
}
