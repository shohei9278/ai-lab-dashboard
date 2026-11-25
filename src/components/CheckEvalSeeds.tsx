"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type SeedView = {
  id: number;
  title: string;
  version: number;
  happened: string; // 何が起きたか（チェックは止めた → 人が公開した など）
  headline: string;
  aiIssues: string[];
  humanComment: string | null;
  suggest: { expect: "ok" | "ng" | "skip"; type: string | null; typeLabel: string | null; score: number; reason: string; model: string } | null;
  suggestError: string | null;
};

const expectLabel = (s: NonNullable<SeedView["suggest"]>) => (s.expect === "skip" ? "入れない" : s.expect === "ok" ? "問題なしとして入れる" : `問題ありとして入れる（${s.typeLabel ?? s.type}）`);

// 試験問題の候補（運営者だけ）。AIのおすすめを見て、1クリックで決める
export function CheckEvalSeeds({ seeds, types }: { seeds: SeedView[]; types: { key: string; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ id: number; text: string } | null>(null);
  const [ngType, setNgType] = useState<Record<number, string>>({});

  async function decide(id: number, decision: "ok" | "ng" | "dismiss", type?: string | null) {
    setBusy(id);
    setMsg(null);
    const res = await fetch("/api/check-eval/seeds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, decision, type }) }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    setBusy(null);
    if (!res?.ok) return setMsg({ id, text: data.error ?? "決められませんでした" });
    router.refresh();
  }

  if (!seeds.length) return null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">試験問題の候補（{seeds.length}件・おすすめ度の高い順）</div>
      <p className="text-xs text-muted">あなたが公開前チェックの結果を覆したページです（止めたのに公開した＝止めすぎかも／通したのに却下した＝見逃しかも）。AIのおすすめを見て決めると、次の評価から試験に入ります。</p>
      <ul className="space-y-2">
        {seeds.map((s) => {
          const sg = s.suggest;
          const one = sg && (sg.expect === "skip" ? { decision: "dismiss" as const, type: null } : { decision: sg.expect, type: sg.type });
          const pick = ngType[s.id] ?? sg?.type ?? types[0]?.key;
          return (
            <li key={s.id} className="space-y-1.5 rounded-lg border border-line p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium">{s.title}<span className="text-xs text-muted">（第{s.version}版）</span></span>
                {sg && <span className="text-xs text-ink-2">おすすめ度 <b className="num">{"★".repeat(sg.score)}{"☆".repeat(5 - sg.score)}</b></span>}
              </div>
              <div className="text-xs text-ink-2">{s.happened}</div>
              <div className="text-xs text-muted">見出し: {s.headline}</div>
              {s.aiIssues.length > 0 && <div className="text-xs text-ink-2">チェックの指摘: {s.aiIssues.join(" / ")}</div>}
              {s.humanComment && <div className="text-xs text-ink-2">あなたのひとこと: {s.humanComment}</div>}
              {sg ? (
                <div className="rounded-lg bg-surface-2 p-2 text-xs">
                  <div><b>AIのおすすめ: {expectLabel(sg)}</b><span className="text-muted">（{sg.model}）</span></div>
                  <div className="mt-0.5 text-ink-2">{sg.reason}</div>
                </div>
              ) : (
                <div className="text-xs text-muted">{s.suggestError ? `AIのおすすめを付けられませんでした（${s.suggestError}）` : "AIがおすすめを考えています…（画面を読み込み直すと出ます）"}</div>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {one && (
                  <button type="button" disabled={busy !== null} onClick={() => decide(s.id, one.decision, one.type)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-accent-ink disabled:opacity-50">
                    {busy === s.id ? "決めています…" : "おすすめどおりにする"}
                  </button>
                )}
                <button type="button" disabled={busy !== null} onClick={() => decide(s.id, "ok")} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50">問題なしで入れる</button>
                <span className="inline-flex items-center gap-1">
                  <button type="button" disabled={busy !== null} onClick={() => decide(s.id, "ng", pick)} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50">問題ありで入れる</button>
                  <select aria-label="問題の種類" value={pick} onChange={(e) => setNgType({ ...ngType, [s.id]: e.target.value })} className="max-w-[12rem] rounded-lg border border-line bg-surface px-1 py-1 text-xs">
                    {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </span>
                <button type="button" disabled={busy !== null} onClick={() => decide(s.id, "dismiss")} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 disabled:opacity-50">入れない</button>
              </div>
              {msg?.id === s.id && <p className="text-xs" style={{ color: "var(--critical)" }} role="alert">{msg.text}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
