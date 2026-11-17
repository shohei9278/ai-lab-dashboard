"use client";

import { useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "./LoopAction";
import { useIdeaBusy } from "./useIdeaBusy";
import { AIMS, AIM_KEYS, type Aim } from "@/lib/aims";

// blocked: 新しい案件を作れない理由。あるときは、会議と採点だけ行い案件にしない（アイデアの質の確かめには使える）
export function IdeaForm({ authors, blocked }: { authors: string[]; blocked: string | null }) {
  const { run, busy, error } = useLoopAction();
  const [theme, setTheme] = useState("");
  const [count, setCount] = useState(3);
  // じっくり案件だけ: ふつうのツールの制限を外して作り込む案だけを出させる（費用が高く、データが要る案は人が確かめるので、件数は2件まで）
  const [deep, setDeep] = useState(false);
  const n = deep ? Math.min(count, 2) : count;
  // ねらい: 空ならおまかせ（設定の配分どおり）。じっくり案件はツールだけなので、需要を確かめる（事前登録LP）は選べない
  const [aim, setAim] = useState<Aim | "">("");
  const aimNow = deep && aim && AIMS[aim].kind !== "tool" ? "" : aim;
  const ideaBusy = useIdeaBusy();

  return (
    <div className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">AIにアイデアを出させる</h2>
        <p className="text-xs text-muted">
          テーマを入れると {authors.join("・")} がそれぞれ{Math.max(2, n)}件ずつ考え、作者を伏せて採点し合い、点数の高い{n}件を案件にします（空欄ならおまかせ）。過去の教訓も踏まえます。1回あたり十数円です。
        </p>
        <div className="mt-2 inline-flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="出させる案の種類">
          {([[false, "ふつう"], [true, "じっくり案件だけ"]] as const).map(([v, label]) => (
            <button
              key={label}
              type="button"
              data-demo-ok
              role="radio"
              aria-checked={deep === v}
              onClick={() => setDeep(v)}
              className={`rounded-md px-2.5 py-1 ${deep === v ? "bg-accent text-accent-ink" : "text-ink-2"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {deep && (
          <p className="mt-1 text-xs text-ink-2">
            ふつうのツールの制限（40,000文字まで・データは代表的なものだけ・フォントなし）を外して作り込む案だけを出させます。できたツールは、見た目を磨く段も通ります。大きなデータ（数百〜2,500件の一覧）が要る案は、AIがデータを下書きし、あなたが判断待ちで確かめてから作ります。手で頼んだ分は、週の上限が埋まっていても作ります（数には入ります）。1件あたりの費用は、ふつうの案件より高くなります。
          </p>
        )}
        {blocked && <p className="mt-1 text-xs text-ink-2">いまは{blocked}。押すと会議と採点だけ行い、案件にはしません（会議の記録には残ります）。</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          maxLength={200}
          placeholder="例: 小さな飲食店の業務効率化"
          // 最低限の幅を持たせる（ホームのライブの欄のように狭い所では、潰れずに件数とボタンが次の行に回る）
          className="min-w-[12rem] flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
        />
        <select
          value={aimNow}
          onChange={(e) => setAim(e.target.value as Aim | "")}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
          aria-label="ねらい"
        >
          <option value="">ねらい: おまかせ（配分どおり）</option>
          {AIM_KEYS.filter((a) => !deep || AIMS[a].kind === "tool").map((a) => <option key={a} value={a}>ねらい: {AIMS[a].label}</option>)}
        </select>
        <select
          value={n}
          onChange={(e) => setCount(Number(e.target.value))}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
          aria-label="件数"
        >
          {(deep ? [1, 2] : [1, 2, 3, 4, 5]).map((x) => <option key={x} value={x}>{x}件</option>)}
        </select>
        <ActionButton
          variant="primary"
          disabled={!!busy || !!ideaBusy}
          onClick={async () => {
            if (await run(`3社のAIが${deep ? "じっくり案件の" : ""}アイデアを考えて採点しています…（1〜2分ほど。ホームのライブでも見られます${blocked ? "。今回は案件にしません" : ""}）`, { action: "ideas", theme, count: n, deep, ...(aimNow ? { aim: aimNow } : {}) })) setTheme("");
          }}
        >
          アイデアを出す
        </ActionButton>
      </div>
      {ideaBusy && !busy && <p className="text-xs text-muted">いま「{ideaBusy}」が動いています。終わると押せるようになります。</p>}
      <BusyNote busy={busy} error={error} />
    </div>
  );
}
