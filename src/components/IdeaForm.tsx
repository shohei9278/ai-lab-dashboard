"use client";

import { useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "./LoopAction";
import { useIdeaBusy } from "./useIdeaBusy";
import { AIMS, AIM_KEYS, GENRES, type Aim } from "@/lib/aims";

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
  // ジャンル: 空なら設定の画面のジャンル（おまかせ）。選んだときは、この1回だけに使い、設定は変えない（11/27 に運営者が決めた）
  const [genre, setGenre] = useState("");
  const ideaBusy = useIdeaBusy();
  // 受け付けたら、会議は裏で進む（ライブで見られる）
  const [accepted, setAccepted] = useState(false);

  return (
    <div className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">AIにアイデアを出させる</h2>
        <p className="text-xs text-muted">
          テーマを入れると {authors.join("・")} がそれぞれ{Math.max(2, n)}件ずつ考え、作者を伏せて採点し合い、点数の高い{n}件を案件にします（空欄ならおまかせ）。過去の教訓も踏まえます。ジャンルを選ぶと、この1回だけそのジャンルで考えます（設定の画面のジャンルは変わりません）。1回あたり十数円です。
        </p>
        <div className="mt-2 inline-flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="出させる案の種類">
          {([[false, "ふつう"], [true, "作り込むツールだけ"]] as const).map(([v, label]) => (
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
            ふつうのツールの制限（40,000文字まで・データは代表的なものだけ・フォントなし）を外して作り込む案だけを出させます。AIが設計書を書いて判断待ち（開発）に出すので、依頼文を Claude Code に貼って作り、できたツールのHTMLを入れてください。大きなデータ（数百〜2,500件の一覧）が要る案は、先にAIがデータを下書きし、あなたが確かめます。手で頼んだ分は、週の上限や開発待ちの上限が埋まっていても作ります（数には入ります）。
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
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
          aria-label="ジャンル（この1回だけ）"
        >
          <option value="">ジャンル: 設定どおり</option>
          {GENRES.map((g) => <option key={g} value={g}>ジャンル: {g}</option>)}
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
            setAccepted(false);
            if (await run("受け付けています…", { action: "ideas", theme, count: n, deep, ...(aimNow ? { aim: aimNow } : {}), ...(genre ? { genre } : {}) })) {
              setTheme("");
              // ジャンルはこの1回だけなので、受け付けたら「設定どおり」に戻す（失敗したときは、選び直さずにもう一度押せるよう残す。PR #223 の ai-review の指摘）
              setGenre("");
              setAccepted(true);
            }
          }}
        >
          アイデアを出す
        </ActionButton>
      </div>
      {accepted && !busy && (
        <p className="text-sm text-ink-2" role="status">
          受け付けました。3社のアイデア会議は裏で進みます（その日まだなら、先にXの話題の投稿も検索するので、数分かかることがあります）。進み具合はホームのライブで見られ、{blocked ? "今回は案件にしません（会議の記録には残ります）" : "終わると案件の一覧に出ます"}。
        </p>
      )}
      {ideaBusy && !busy && <p className="text-xs text-muted">いま「{ideaBusy}」が動いています。終わると押せるようになります。</p>}
      <BusyNote busy={busy} error={error} />
    </div>
  );
}
