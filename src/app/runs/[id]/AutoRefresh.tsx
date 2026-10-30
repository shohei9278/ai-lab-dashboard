"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// 実行中のあいだだけ画面を定期的に更新する
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
