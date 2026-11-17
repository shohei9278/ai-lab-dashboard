"use client";

import { useState, type ReactNode } from "react";
import { PageFrame } from "./PageFrame";

// ツールの案件で、AIが自由に書いたページを出す: 上の部分（短い見出し）→ ツール → 下の部分（困りごと・できること など）
// 上下はそれぞれ隔離した枠で、高さは中身に合わせる。上下に分けるのはサーバー（htmlDom.ts の splitToolPage）で、ここには分けたあとの2つを渡す
export function ToolPageView({ parts, title, imgOrigins, operator, tool, after }: {
  parts: { top: string; bottom: string }; title: string; imgOrigins: string[]; operator: string; tool: ReactNode; after?: ReactNode;
}) {
  // ツールのまわりは、ページの背景と同じ色にする（上の枠が知らせる。分かるまでは透明）
  const [bg, setBg] = useState<string | undefined>(undefined);
  return (
    <div>
      <PageFrame autoHeight html={parts.top} title={`${title}（見出し）`} imgOrigins={imgOrigins} operator={operator} onBackground={setBg} />
      <section id="tool" data-section="tool" className="px-4 pb-8 pt-2" style={bg ? { background: bg } : undefined}>
        <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg)] shadow-xl">{tool}</div>
      </section>
      <PageFrame autoHeight html={parts.bottom} title={`${title}（説明）`} imgOrigins={imgOrigins} operator={operator} />
      {after}
    </div>
  );
}
