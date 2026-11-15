"use client";

import { usePathname } from "next/navigation";

// 公開ページ（/showcase）では、ダッシュボードのメニューや作業中の表示を出さない
// ルートのレイアウトはページを移っても作り直されないので、開いているページの判定は画面側でする
export function AppShell({ nav, banner, overlay, children }: { nav: React.ReactNode; banner: React.ReactNode; overlay: React.ReactNode; children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/showcase") return <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>;
  return (
    <>
      {/* キーボードで操作する人が、メニューを飛ばして本文へ行けるように（Tab を押したときだけ見える） */}
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow">本文へ移動</a>
      <div className="lg:flex">
        {nav}
        <div className="min-w-0 flex-1">
          {banner}
          <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 outline-none lg:px-6">{children}</main>
        </div>
      </div>
      {overlay}
    </>
  );
}
