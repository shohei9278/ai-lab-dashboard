"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function KillSwitch({ active }: { active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!active && !confirm("実行中のものも含めて、すべての処理を止めます。よろしいですか？")) return;
    setBusy(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ killSwitch: !active }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
      style={
        active
          ? { borderColor: "var(--border)", color: "var(--text)" }
          : { borderColor: "var(--critical)", color: "var(--critical)" }
      }
    >
      {active ? "緊急停止を解除" : "■ 緊急停止"}
    </button>
  );
}
