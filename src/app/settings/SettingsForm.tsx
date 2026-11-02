"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApprovalMode, Settings } from "@/lib/db";

const MODES: { id: ApprovalMode; label: string; body: string }[] = [
  { id: "manual", label: "毎回承認", body: "アイデアの採用・LPの公開・改善・撤退のすべてで、あなたの承認を待ちます。" },
  { id: "auto", label: "自動で進める", body: "アイデアの採用とLPの改善はAIが進めます。最初の公開と、続ける・撤退の判断だけ承認します。" },
  { id: "alternate", label: "交互（比較用）", body: "新しい案件を2つのモードに交互に割り当てて、結果を比べます。" },
];

export function SettingsForm({ initial, models, publishing }: {
  initial: Settings; models: { id: string; label: string; ok: boolean }[]; publishing: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState({
    ...initial,
    targetPct: Math.round(initial.targetSignupRate * 1000) / 10,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const num = (k: keyof typeof v) => ({
    value: v[k] as number,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never),
  });

  async function save() {
    const { targetPct, lastDailyRun, killSwitch, ...rest } = v;
    void lastDailyRun; void killSwitch; // 画面からは変えない
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rest, targetSignupRate: targetPct / 100 }),
    });
    const data = await res.json();
    setMsg(res.ok ? "保存しました" : data.error);
    router.refresh();
  }

  const input = "num block w-32 rounded-lg border border-line bg-surface px-2 py-1";
  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <h2 className="font-bold">進め方（モード）</h2>
        <p className="text-xs text-muted">新しく作られる案件に適用されます。すでにある案件のモードは変わりません。お金がかかる最初の公開と、続ける・撤退の判断は、どのモードでも人が承認します。</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <label key={m.id} className={`cursor-pointer rounded-lg border p-3 text-sm ${v.approvalMode === m.id ? "border-accent" : "border-line"}`}>
              <div className="flex items-center gap-2 font-medium">
                <input type="radio" name="mode" checked={v.approvalMode === m.id} onChange={() => set("approvalMode", m.id)} />
                {m.label}
              </div>
              <p className="mt-1 text-xs text-ink-2">{m.body}</p>
            </label>
          ))}
        </div>
        <Field label="自動モードで、承認なしにLPを改善してよい回数" note="これを超えたら人の判断に回します。改善は1回に1か所だけ、対象読者と仮説は変えません。">
          <input type="number" min={0} {...num("maxAutoImprove")} className={input} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.shadowJudge} onChange={(e) => set("shadowJudge", e.target.checked)} />
          <span>
            判断の裏比較を行う
            <span className="block text-xs text-muted">AIが判断するたびに、他社の上位AIにも同じ判断をさせて記録します（1回あたり約3〜8円の上乗せ）。結果は「AIの使い分け」で見られます。</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.debateEnabled} onChange={(e) => set("debateEnabled", e.target.checked)} />
          <span>
            AIの判断が割れたら議論させる
            <span className="block text-xs text-muted">裏比較で意見が割れたときだけ、各AIに1回反論させて要約します（割れたときだけ1回あたり約10円の上乗せ）。</span>
          </span>
        </label>
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">毎日の自動アイデア出し</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.dailyEnabled} onChange={(e) => set("dailyEnabled", e.target.checked)} />
            有効にする
          </label>
        </div>
        <p className="text-xs text-muted">
          毎日1回、3社のAI（Claude・GPT・Gemini）がそれぞれアイデアを出し、作者を伏せて3社全員で採点して、平均点の上位を進めます（自動モードの案件はLPまで作ります）。費用の目安は1日25〜35円です。
          このアプリ（サーバー）が起動している間だけ動きます。
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="実行する時刻（この時以降）"><input type="number" min={0} max={23} {...num("dailyHour")} className={input} /></Field>
          <Field label="1社あたりのアイデア数"><input type="number" min={1} max={5} {...num("dailyIdeaCount")} className={input} /></Field>
          <Field label="そのうち進める数（3社の合計から）"><input type="number" min={1} max={5} {...num("dailyKeep")} className={input} /></Field>
          <Field label="承認待ちの上限" note="これ以上たまっていたら、その日は休みます。"><input type="number" min={1} {...num("maxPending")} className={input} /></Field>
          <Field label="集客中の上限" note="これ以上あれば、その日は休みます。"><input type="number" min={1} {...num("maxLive")} className={input} /></Field>
          <Field label="承認待ちの期限（日）" note="過ぎたら自動で見送りにします。"><input type="number" min={1} {...num("staleDays")} className={input} /></Field>
        </div>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="font-bold">判断の基準</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="使うAI" note="アイデア出し・LP作成・チェック・判断・教訓メモで使います。">
            <select value={v.loopModel} onChange={(e) => set("loopModel", e.target.value)} className="block rounded-lg border border-line bg-surface px-2 py-1">
              {models.map((m) => <option key={m.id} value={m.id} disabled={!m.ok}>{m.label}{m.ok ? "" : "（キーなし）"}</option>)}
            </select>
          </Field>
          <Field label="1案件あたりの広告費の上限（円）" note="これに達したら、AIが判断に入ります。">
            <input type="number" min={0} {...num("adBudgetPerProjectJpy")} className={input} />
          </Field>
          <Field
            label="上限を超えたあと、改善に使ってよい追加の広告費（円）"
            note="0にすると、上限に達した案件は「続ける」か「撤退」のどちらかで判断します。金額を入れると、その範囲で1回LPを改善して再挑戦できます（上限＋この金額に達したら、もう一度判断します）。"
          >
            <input type="number" min={0} {...num("improveExtraBudgetJpy")} className={input} />
          </Field>
          <Field label="判断に入る訪問数" note="今のLPの版での訪問がこの人数を超えたら、AIが続ける・改善・撤退を提案します。">
            <input type="number" min={1} {...num("judgeMinVisits")} className={input} />
          </Field>
          <Field label="登録率の目標（%）" note="これを下回ると撤退の候補になります。">
            <input type="number" min={0.1} step="0.1" {...num("targetPct")} className={input} />
          </Field>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">公開用LPサイト</h2>
          <span className="text-sm" style={{ color: publishing ? "var(--good)" : "var(--muted)" }}>
            {publishing ? "✓ Supabase に接続済み" : "○ 未設定（公開は手動の前提）"}
          </span>
        </div>
        <p className="text-xs text-muted">
          公開を承認すると、LPがこのURLの下に「/p案件番号」で公開されます。訪問と登録の数は15分ごとに自動で取り込みます。
          接続には <code>.env.local</code> に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です（手順は docs/SETUP-LP.md）。
        </p>
        <Field label="LPサイトのURL（独自ドメイン）">
          <input
            type="url"
            placeholder="https://example.com"
            value={v.lpBaseUrl}
            onChange={(e) => set("lpBaseUrl", e.target.value)}
            className="block w-full max-w-md rounded-lg border border-line bg-surface px-2 py-1"
          />
        </Field>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="font-bold">AI費用の予算</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="月間のAI費用の上限（円）" note="製品ループとテストの合計。超えるとAIの呼び出しが止まります。">
            <input type="number" min={0} {...num("monthlyBudgetJpy")} className={input} />
          </Field>
          <Field label="為替レート（1ドル = 円）">
            <input type="number" min={1} step="0.1" {...num("usdJpy")} className={input} />
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink">保存</button>
        {msg && <span className="text-sm text-ink-2">{msg}</span>}
      </div>
    </div>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="block text-xs text-ink-2">{label}</span>
      {children}
      {note && <span className="block text-xs text-muted">{note}</span>}
    </label>
  );
}
