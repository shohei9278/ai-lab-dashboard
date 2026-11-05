"use client";

import { useEffect } from "react";

// ブックマークレットの小さな窓を、少し待ってから閉じる
export function CloseSoon() {
  useEffect(() => {
    const t = setTimeout(() => window.close(), 1800);
    return () => clearTimeout(t);
  }, []);
  return <p className="text-xs text-muted">この窓は自動で閉じます。</p>;
}
