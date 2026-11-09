"use client";

import { Children, useEffect, useState, type ReactNode } from "react";

// 長くなる一覧を、最初は一部だけ出して「もっと見る」で続きを開く
// data-demo-ok: 閲覧専用モードの人も押せるようにする（読むだけの操作なので）
// URLの #… が、まだ隠れている行を指しているときは、全部開いてその行まで移動する
export function ShowMore({ children, initial = 10, step, as: Tag = "div", className, head }: {
  children: ReactNode; initial?: number; step?: number; as?: "div" | "ul" | "ol" | "table"; className?: string; head?: ReactNode;
}) {
  const items = Children.toArray(children);
  const [count, setCount] = useState(initial);
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && !document.getElementById(id)) setCount(Number.MAX_SAFE_INTEGER);
  }, []);
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && count === Number.MAX_SAFE_INTEGER) document.getElementById(id)?.scrollIntoView();
  }, [count]);
  const shown = items.slice(0, count);
  const rest = items.length - shown.length;
  return (
    <>
      {Tag === "table" ? <table className={className}>{head}<tbody>{shown}</tbody></table> : <Tag className={className}>{shown}</Tag>}
      {rest > 0 && (
        <button type="button" data-demo-ok onClick={() => setCount((n) => n + (step ?? initial))} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink-2 hover:bg-surface-2">
          もっと見る（残り{rest}件）
        </button>
      )}
    </>
  );
}
