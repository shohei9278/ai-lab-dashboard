"use client";

import { useEffect, useState } from "react";

// 公開中のデモを見に来た人向け: ボタンは見せたまま、押すと「デモでは押せません」と出す
// 実際の操作はサーバー側（middleware）で断っているので、これは見た目と説明のため
export function GuestGuard() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (el: Element) => {
      const label = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const cost = label.match(/約[\d〜,]+円/)?.[0];
      setMsg(`公開中のデモでは押せません${label ? `：「${label}」` : ""}${cost ? `（実際には${cost}かかります）` : ""}`);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 4000);
    };
    const block = (e: Event) => {
      const t = e.target as Element | null;
      const el = t?.closest("button, input[type=checkbox], input[type=radio], input[type=submit], select");
      if (!el || el.closest("[data-demo-ok]")) return;
      e.preventDefault();
      e.stopPropagation();
      show(el);
    };
    document.addEventListener("click", block, true);
    document.addEventListener("mousedown", block, true);
    document.addEventListener("submit", block, true);
    return () => {
      document.removeEventListener("click", block, true);
      document.removeEventListener("mousedown", block, true);
      document.removeEventListener("submit", block, true);
    };
  }, []);
  return (
    <>
      <style>{`main button:not([data-demo-ok]), main select, main input[type=checkbox], main input[type=radio] { cursor: not-allowed } main button:not([data-demo-ok]) { opacity: .6 }`}</style>
      {msg && (
        <div role="status" className="fixed bottom-20 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-line bg-surface px-4 py-2 text-sm shadow-lg">
          {msg}
        </div>
      )}
    </>
  );
}
