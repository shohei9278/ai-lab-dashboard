"use client";

import Link from "next/link";
import { useState } from "react";
import { gaEvent } from "@/lib/ga";
import { lpButtonClass, lpButtonStyle } from "@/lp/LpView";
import { visitorId } from "./visitor";

export function SignupForm({ slug, version, cta }: { slug: string; version: number; cta: string }) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // ロボット対策の見えない欄（人は入力しない）
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [started, setStarted] = useState(false);
  const ga = { lp_slug: slug, lp_version: version };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, version, email, consent, website, visitorId: visitorId() }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) {
      setState("done");
      gaEvent("sign_up", { ...ga, method: "email" });
    } else {
      setState("error");
      setMessage(data.error ?? "送信できませんでした。時間をおいてもう一度お試しください。");
      gaEvent("sign_up_error", ga);
    }
  }

  if (state === "done") {
    return (
      <p className="rounded-lg border border-line p-4" role="status">
        <span style={{ color: "var(--good)" }}>✓</span> 登録を受け付けました。提供を始めるときに、メールでご案内します。
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      <label className="block text-sm">
        メールアドレス
        <input
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onFocus={() => {
            if (started) return;
            setStarted(true);
            gaEvent("form_start", ga);
          }}
          className="mt-1 block w-full rounded-lg border border-line bg-bg px-3 py-2"
        />
      </label>
      <div aria-hidden className="absolute -left-[9999px]">
        <label>
          ウェブサイト
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>
          <Link href="/privacy" target="_blank" className="underline">プライバシーポリシー</Link>に同意します
        </span>
      </label>
      <button
        type="submit"
        disabled={state === "sending"}
        className={`${lpButtonClass} w-full`}
        style={lpButtonStyle}
      >
        {state === "sending" ? "送信しています…" : cta}
      </button>
      {state === "error" && <p className="text-sm" style={{ color: "var(--critical)" }} role="alert">{message}</p>}
    </form>
  );
}
