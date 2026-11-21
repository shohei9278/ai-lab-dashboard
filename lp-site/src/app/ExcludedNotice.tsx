"use client";

import { useEffect, useState } from "react";
import { isExcluded } from "./[slug]/visitor";

// 閉じたことを、このブラウザに残す（遊ぶ画面が高さいっぱいに出るかを、この表示なしで確かめられるように。運営者が頼んだ）
// ?me=0 で数える設定に戻したら、閉じたことも忘れる（あとで ?me=1 で数えない設定にしたときに、また出す）
// ?me=1 のついた URL を読み込み直しても、閉じたままにする
const HIDDEN_KEY = "lp_exclude_notice_hidden";

function hidden(): boolean {
  try {
    if (new URLSearchParams(location.search).get("me") === "0") localStorage.removeItem(HIDDEN_KEY);
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

// 運営者のブラウザにだけ出す表示（訪問者には出ない）。右の × で閉じられる
export function ExcludedNotice() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const h = hidden(); // 先に読む（?me=0 のときに、閉じたことを忘れさせるため。数えない設定でないときも通す）
    setOn(isExcluded() && !h);
  }, []);
  if (!on) return null;
  const close = () => {
    try { localStorage.setItem(HIDDEN_KEY, "1"); } catch {}
    setOn(false);
  };
  return (
    <div className="flex items-center gap-2 bg-[color:var(--text)] py-2 pl-4 pr-1 text-xs text-[color:var(--bg)]" role="status">
      <p className="min-w-0 flex-1 text-center">
        このブラウザの訪問・利用・登録は数えていません（運営者用の設定）。元に戻すには、URLの最後に <code>?me=0</code> を付けて開いてください。
      </p>
      <button type="button" onClick={close} aria-label="この表示を閉じる" title="閉じる（?me=0 で数える設定に戻すまで、このブラウザでは出しません）" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base leading-none hover:opacity-70">
        ×
      </button>
    </div>
  );
}
