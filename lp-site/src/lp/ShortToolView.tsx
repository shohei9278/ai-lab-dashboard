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
// play: 公開サイトの遊ぶ画面。ツールの枠を画面に固定して、見えている範囲いっぱいに出す（運営者が決めた。inApp.ts）
//   - 上には細い帯（28px）だけを置き、左にサイトの入口（home）、真ん中にツール名、右にメニューのボタン（menu）を出す。
//     帯をなくしてボタンをツールの上に浮かせると、公開中のツールの題名や右上のボタンに重なったため、細い帯に戻した（運営者が決めた）
//   - 枠は「下の端 0・高さ（画面の高さ − 上の空き）」で固定する。X の iPhone のアプリの中では、上と下の両方で決めた固定の要素だけが、
//     上は X の上の帯の下に出るのに高さは画面全体のままで、下が帯の分（約60px）はみ出した。下の端だけで決めた固定の要素は、
//     見えている範囲の下の端に正しく出る（運営者が /inapp-check で確かめた）
//   - X のアプリの中では、上を --lab-inapp-top だけ空ける（高さから引く。X の上の帯の下に隠れないように）
//   - シェア・ほかの遊び・ひとこと・プライバシーポリシーは、メニューのボタンから開く欄にまとめる
//   - 一行の説明は、読み上げと検索のためにだけ残す（画面には出さない）
export function ShortToolView({ title, lead, tool, after, home, barEnd, frameHeight = SHORT_FRAME_HEIGHT, play = false, menu }: { title: string; lead: string; tool: ReactNode; after?: ReactNode; home?: ReactNode; barEnd?: ReactNode; frameHeight?: string; play?: boolean; menu?: ReactNode }) {
  if (play) {
    return (
      <div>
        {lead && <p className="sr-only">{lead}</p>}
        {/* 遊ぶ画面の後ろを塞ぐ（X のときに上を空けた所や、PC の左右に、ページの下の欄が透けて見えないように） */}
        <div aria-hidden className="fixed inset-0 z-20 bg-[color:var(--bg)]" />
        <section id="tool" data-section="tool" data-play="" className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-3xl flex-col bg-[color:var(--bg)] sm:border-x sm:border-[color:var(--border)] lab-play-h">
          <header className="flex h-7 shrink-0 items-center gap-2 border-b border-[color:var(--border)] px-3 text-xs">
            {home && <div className="shrink-0 font-bold">{home}</div>}
            <h1 className="min-w-0 flex-1 truncate text-ink-2">{title}</h1>
            {menu && <div className="shrink-0">{menu}</div>}
          </header>
          <div className="relative min-h-0 flex-1 overflow-hidden">{tool}</div>
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
