"use client";

import { useCallback, useEffect, useState } from "react";
import { gaEvent } from "@/lib/ga";
import { ToolFrame } from "@/lp/ToolFrame";
import type { DepthEvent } from "@/lp/playDepth";
import type { ToolImages } from "@/lp/content";
import { lpButtonClass, lpButtonStyle } from "@/lp/LpView";
import { isExcluded, visitorId } from "./visitor";

function record(slug: string, version: number, kind: "use" | "share") {
  if (isExcluded()) return;
  fetch("/api/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, version, kind, visitorId: visitorId() }),
    keepalive: true,
  }).catch(() => {});
}

// ツール本体。最初に操作されたときに「使った」と記録する
export function ToolSection({ slug, version, html, title, data, fonts, illustration, images, fill, fit }: { slug: string; version: number; html: string; title: string; data?: unknown[]; fonts?: boolean; illustration?: string; images?: ToolImages; fill?: boolean; fit?: boolean }) {
  const onUse = useCallback(() => {
    record(slug, version, "use");
    gaEvent("tool_use", { lp_slug: slug, lp_version: version });
  }, [slug, version]);
  // 遊びの深さ（遊んだ時間・結果を出した回数・結果の種類）の区切りを超えたら記録する（ダッシュボードの「遊びの深さ」）
  // 運営者のブラウザ（?me=1）は、「操作した」と同じく記録しない（gaEvent も止めるが、ここでもそろえる。PR #123 の ai-review の指摘）
  const onDepth = useCallback((e: DepthEvent) => {
    if (isExcluded()) return;
    gaEvent(e.name, { lp_slug: slug, lp_version: version, value: e.value });
  }, [slug, version]);
  return <ToolFrame html={html} title={title} onUse={onUse} onDepth={onDepth}data={data} fonts={fonts} illustration={illustration} images={images} fill={fill} storeKey={slug} fit={fit} />;
}

// シェアのボタン（X とリンクのコピー）
// results: 結果の種類が決まっているツールの結果の名前。ツールが結果の番号を知らせたら、シェアのリンクに ?r=番号 を付ける（その結果のシェア画像になる）
export function ShareButtons({ slug, version, text, results }: { slug: string; version: number; text: string; results?: string[] }) {
  const [copied, setCopied] = useState(false);
  const shared = (method: string) => {
    record(slug, version, "share");
    gaEvent("share", { lp_slug: slug, lp_version: version, method });
  };
  const [url, setUrl] = useState("");
  // ツールで結果が出たら、その結果の一文をシェアの文の頭に付ける（出ていなければ決まった文のまま）
  const [result, setResult] = useState("");
  useEffect(() => {
    const on = (e: Event) => setResult(String((e as CustomEvent).detail ?? "").slice(0, 200));
    window.addEventListener("lab-share-text", on);
    return () => window.removeEventListener("lab-share-text", on);
  }, []);
  const [resultNo, setResultNo] = useState<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const i = Number((e as CustomEvent).detail);
      setResultNo(Number.isInteger(i) && i >= 0 && i < (results?.length ?? 0) ? i : null);
    };
    window.addEventListener("lab-share-result", on);
    return () => window.removeEventListener("lab-share-result", on);
  }, [results]);
  const shareText = result ? `${result}\n${text}` : text;
  // シェアするリンクには、どこから来たかの目印（?s=…）を引き継がない
  useEffect(() => setUrl(window.location.origin + window.location.pathname), []);
  // 結果の番号が分かっていれば、その結果のシェア画像が出るリンクにする
  const shareUrl = url && resultNo !== null ? `${url}?r=${resultNo}` : url;
  return (
    <div className="flex flex-wrap justify-center gap-3">
      <a
        href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
        target="_blank"
        rel="noreferrer"
        onClick={() => shared("x")}
        className={lpButtonClass}
        style={lpButtonStyle}
      >
        X でシェア
      </a>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            shared("copy");
          } catch {}
        }}
        className="rounded-full border border-[color:var(--border)] px-6 py-3 font-bold"
      >
        {copied ? "コピーしました" : "リンクをコピー"}
      </button>
    </div>
  );
}
