import type { ReactNode } from "react";

// 遊び・毎日のお題など（ねらいが「広がる」「また来てもらう」）のツールの、短いページ（content.ts の short）
// - 紹介ページ（悩み・手順・称号の一覧など）は作らない。触れば分かり、説明はネタばらしになりやすく、読まれないため
// - 開いたらすぐ遊べるよう、細い上の帯（サイト名・ツール名）の下を、ツールが画面の高さいっぱいに使う（運営者の依頼。ゲームのサイトのように没頭できるように）
//   ページがスクロールして操作とぶつからないよう、枠の高さは画面に合わせて決める（中身が長ければ、枠の中でスクロールする）
// - 一行の説明とシェアの欄は、ツールの下に置く（検索・シェアのための文は残す）
// - 運営者名とプライバシーポリシーは、サイト全体の下の欄に出る
// ツールの下のシェアの欄の見出し（公開サイトとダッシュボードのプレビュー、結果のあとの欄で同じ文にする）
export const SHORT_SHARE_HEADING = "楽しかったら、シェアしてもらえるとうれしいです";
// ツールの枠の高さ（画面の高さから、上の帯の高さ h-11 を引いたもの）。ダッシュボードのプレビューなど、play でないときに使う
export const SHORT_FRAME_HEIGHT = "calc(100dvh - 2.75rem)";

// home: 上の帯の左に出す、サイトの入口へのリンク（プレビューでは押せないもの）
// barEnd: 上の帯の右に出すもの（結果が出たあとの「シェア・ほかの遊び」のボタン）
// frameHeight: ツールの枠の高さ（プレビューでは、画面の高さの代わりに決まった高さにする）
// play: 公開サイトの遊ぶ画面。細い帯とツールの枠だけで、見えている範囲いっぱいを使う（運営者が決めた。inApp.ts）
//   - 上には細い帯（28px）だけを置き、左にサイトの入口（home）とツール名、右にメニューのボタン（menu）を出す。
//     帯をなくしてボタンをツールの上に浮かせると、公開中のツールの題名や右上のボタンに重なったため、細い帯に戻した（運営者が決めた）
//   - 帯と枠は、画面に固定せず、ふつうに並べる。X の iPhone のアプリの中では、画面に固定した帯と枠が、上も下もそろって約60px 下にずれて
//     描かれ（ページからはずれが測れない）、上に隙間が空き、下が X の帯の下に潜った。ふつうに並べたものは X が上の帯の下から出すので、
//     全体の高さを「画面の高さ − X のときは --lab-inapp-top」にすれば、下も X の帯の上に収まる（運営者が /inapp-check で確かめた）
//   - ページ全体はスクロールさせない（globals.css）。メニューの欄は下の端だけで固定する（X の中でも正しく出る形）
//   - 枠の高さは 100% の計算に頼らず、位置（上下左右 0）で決める（ブラウザによって 100% の計算が違うことがあるため）
//   - シェア・ほかの遊び・ひとこと・プライバシーポリシーは、メニューのボタンから開く欄にまとめる
//   - 一行の説明は、読み上げと検索のためにだけ残す（画面には出さない）
export function ShortToolView({ title, lead, tool, after, home, barEnd, frameHeight = SHORT_FRAME_HEIGHT, play = false, menu }: { title: string; lead: string; tool: ReactNode; after?: ReactNode; home?: ReactNode; barEnd?: ReactNode; frameHeight?: string; play?: boolean; menu?: ReactNode }) {
  if (play) {
    return (
      <div>
        {lead && <p className="sr-only">{lead}</p>}
        <section id="tool" data-section="tool" data-play="" className="lab-play-h mx-auto flex max-w-3xl flex-col bg-[color:var(--bg)] sm:border-x sm:border-[color:var(--border)]">
          <header className="flex h-7 shrink-0 items-center gap-2 border-b border-[color:var(--border)] px-3 text-xs">
            {home && <div className="shrink-0 font-bold">{home}</div>}
            <h1 className="min-w-0 flex-1 truncate text-ink-2">{title}</h1>
            {menu && <div className="shrink-0">{menu}</div>}
          </header>
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 overflow-hidden">{tool}</div>
          </div>
        </section>
      </div>
    );
  }
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
