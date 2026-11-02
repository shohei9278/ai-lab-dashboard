"use client";

import { useEffect, useState } from "react";
import { isExcluded } from "./[slug]/visitor";

// 運営者のブラウザにだけ出す表示（訪問者には出ない）
export function ExcludedNotice() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isExcluded()), []);
  if (!on) return null;
  return (
    <div className="bg-[color:var(--text)] px-4 py-2 text-center text-xs text-[color:var(--bg)]" role="status">
      このブラウザの訪問・利用・登録は数えていません（運営者用の設定）。元に戻すには、URLの最後に <code>?me=0</code> を付けて開いてください。
    </div>
  );
}
