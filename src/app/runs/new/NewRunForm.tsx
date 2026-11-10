"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ModelDef } from "@/lib/models";

type ModelOpt = ModelDef & { providerLabel: string; hasKey: boolean };
type TaskOpt = { id: string; label: string; items: number };
type Estimate = { calls: number; usd: number; perModel: { modelId: string; calls: number; usd: number; measured: boolean }[] };

const fmtYen = (usd: number, rate: number) => {
  const v = usd * rate;
  return v < 100 ? `${v.toFixed(1)}円` : `${Math.round(v).toLocaleString("ja-JP")}円`;
};

export function NewRunForm({ models, tasks }: { models: ModelOpt[]; tasks: TaskOpt[] }) {
  const router = useRouter();
  const [task, setTask] = useState(tasks[0].id);
  const [selected, setSelected] = useState<string[]>(models.map((m) => m.id));
  const [reps, setReps] = useState(3);
  const [variant, setVariant] = useState("basic");
  const [lang, setLang] = useState("ja");
  const [mock, setMock] = useState(true);
  const [note, setNote] = useState("");
  // 断られたとき（公開中のデモなど）は error だけが返り、見積もりは入っていない
  const [est, setEst] = useState<{ error: string | null; estimate?: Estimate; usdJpy?: number; forKey: string } | null>(null);
  // 今の入力に対する見積もりだけを使う（入力を変えたら、新しい見積もりが届くまで実APIでは実行できない）
  const estKey = JSON.stringify([task, selected, reps, variant, lang, mock]);
  const estimate = est?.forKey === estKey ? est.estimate : undefined;
  const usdJpy = est?.usdJpy ?? 0;
  // 実際のAPIは費用がかかるので、見積もりを確かめられないときは実行させない
  const needsEstimate = !mock && !estimate;
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const config = { task, models: selected, reps, variant, lang, mock, note };

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, dryRun: true }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d) => setEst({ ...d, forKey: estKey }))
      .catch((e) => {
        if (e instanceof Error && e.name !== "AbortError") setEst(null);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, selected.join(","), reps, variant, lang, mock]);

  async function submit() {
    if (needsEstimate) return;
    if (!mock && estimate && !confirm(`実際のAPIを呼び出します。見積もり ${fmtYen(estimate.usd, usdJpy)} です。実行しますか？`)) return;
    setSubmitting(true);
    setSubmitError(null);
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) return setSubmitError(data.error);
    router.push(`/runs/${data.id}`);
  }

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const itemCount = tasks.find((t) => t.id === task)?.items ?? 0;
  const error = submitError ?? est?.error ?? (!mock && !est ? "費用の見積もりを確かめられないため、実際のAPIでは実行できません" : null);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="card space-y-5 p-4">
        <Field label="タスク">
          <div className="flex flex-wrap gap-2">
            {tasks.map((t) => (
              <Chip key={t.id} active={task === t.id} onClick={() => setTask(t.id)}>
                {t.label}（{t.items}問）
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="モデル">
          <div className="grid gap-2 sm:grid-cols-2">
            {models.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line p-2 text-sm hover:bg-surface-2">
                <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${m.provider})` }} />
                <span className="flex-1">{m.label}</span>
                <span className="text-xs text-muted">{m.tier === "top" ? "上位" : "軽量"}</span>
                {!m.verified && <span className="text-xs text-muted" title="料金・モデル名は公式ページで要確認">要確認</span>}
                {!mock && !m.hasKey && <span className="text-xs" style={{ color: "var(--critical)" }}>キーなし</span>}
              </label>
            ))}
          </div>
        </Field>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="繰り返し回数（ブレ測定）">
            <input
              type="number" min={1} max={20} value={reps}
              onChange={(e) => setReps(Number(e.target.value))}
              className="num w-24 rounded-lg border border-line bg-surface px-2 py-1"
            />
          </Field>
          <Field label="プロンプト">
            <div className="flex gap-2">
              <Chip active={variant === "basic"} onClick={() => setVariant("basic")}>シンプル</Chip>
              <Chip active={variant === "detailed"} onClick={() => setVariant("detailed")}>詳細</Chip>
            </div>
          </Field>
          <Field label="指示の言語">
            <div className="flex gap-2">
              <Chip active={lang === "ja"} onClick={() => setLang("ja")}>日本語</Chip>
              <Chip active={lang === "en"} onClick={() => setLang("en")}>英語</Chip>
            </div>
          </Field>
        </div>

        <Field label="実行モード">
          <div className="flex flex-wrap gap-2">
            <Chip active={mock} onClick={() => setMock(true)}>ダミー（無料・動作確認用）</Chip>
            <Chip active={!mock} onClick={() => setMock(false)}>実API（費用が発生）</Chip>
          </div>
        </Field>

        <Field label="メモ（任意）">
          <input
            value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
            placeholder="例: 10月の定点観測"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm"
          />
        </Field>
      </div>

      <aside className="card h-fit space-y-3 p-4">
        <h2 className="font-bold">実行前の見積もり</h2>
        <div className="num text-sm text-ink-2">
          {itemCount}問 × {reps}回 × {selected.length}モデル = <b className="text-ink">{estimate?.calls ?? 0}回</b>
        </div>
        <div>
          <div className="text-xs text-muted">{mock ? "ダミーのため実際の費用は0円（参考値）" : "見積もり費用"}</div>
          <div className="num text-2xl font-bold">{estimate ? fmtYen(estimate.usd, usdJpy) : "—"}</div>
        </div>
        {estimate && estimate.perModel.length > 0 && (
          <ul className="space-y-1 text-xs text-ink-2">
            {estimate.perModel.map((p) => (
              <li key={p.modelId} className="num flex justify-between">
                <span>{models.find((m) => m.id === p.modelId)?.label}</span>
                <span>{fmtYen(p.usd, usdJpy)}{p.measured ? "" : " *"}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">
          同じ条件の実API結果があれば、その実測値に1.5倍の余裕を見て計算します。* は実測がなく、多めの見込みで計算したモデルです。
        </p>
        {error && (
          <p className="text-sm" style={{ color: "var(--critical)" }}>
            <span aria-hidden>! </span>{error}
          </p>
        )}
        <button
          onClick={submit}
          disabled={submitting || needsEstimate || !!est?.error || selected.length === 0}
          className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {submitting ? "開始中…" : "実行する"}
        </button>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-sm ${active ? "border-accent bg-accent text-accent-ink" : "border-line hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}
