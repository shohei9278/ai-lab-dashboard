import Link from "next/link";
import { jstDateTime } from "@/lib/format";
import type { ToolRoutineStatus } from "@/lib/toolRoutine";

// ルーティンに自動で頼む今の様子（11/28 に運営者が決めた。開発待ちが自動で頼まれないとき、上限で待っているのか・作業中の順番待ちなのか・設定で止まっているのかを分かるように）
// nextCheckAt: 次の見回りの時刻（ms。5分に1回）。まだ見ていなければ null
export function RoutinePanel({ st, nextCheckAt }: { st: ToolRoutineStatus; nextCheckAt: number | null }) {
  const at = (ms: number) => jstDateTime(new Date(ms).toISOString());
  const full = st.working.length >= st.concurrent;
  const cap = st.resumeAt ? `直近24時間に${st.fired}件頼み、1日の上限（${st.perDay}件）に達しています。${jstDateTime(st.resumeAt)} のあとの見回りから、次を頼めます` : null;
  const working = st.working.length ? `作業中: ${st.working.map((w) => `#${w.projectId}「${w.title}」（${jstDateTime(w.at)} に頼んだ）`).join("・")}` : null;
  const state = st.off
    ? { label: "止まっています", text: `${st.off}。開発待ちは自動では頼みません（カードから手で頼めます）` }
    : !st.next
      ? { label: "頼むものがありません", text: "順番を待っている開発待ちはありません" }
      : cap
        ? { label: "上限で待っています", text: cap }
        : full
          ? { label: "作業中の順番待ち", text: `同時に頼む数（${st.concurrent}件）がうまっているので、作業中のものが入るか、頼んでから3時間たつまで待ちます` }
          : { label: "次を頼みます", text: `次の見回り（${nextCheckAt ? `${at(nextCheckAt)}ごろ` : "5分以内"}）で頼みます` };
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm" role="status">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs text-muted">ルーティンへの自動の依頼</span>
        <b>{state.label}</b>
        <span className="num text-xs text-ink-2">直近24時間 {st.fired}/{st.perDay}件・作業中 {st.working.length}/{st.concurrent}件・順番待ち {st.waiting}件</span>
      </div>
      <p className="mt-1 text-xs text-ink-2">{state.text}</p>
      {working && <p className="mt-1 text-xs text-ink-2">{working}</p>}
      {/* 止めているときも、上限は重なりうるので出す（上限で待っているときは、上の文と同じなので出さない） */}
      {cap && st.off && st.next && <p className="mt-1 text-xs text-ink-2">{cap}</p>}
      {st.next && <p className="mt-1 text-xs text-ink-2">次に頼む開発待ち: <Link href={`/projects/${st.next.projectId}`} className="text-accent underline"><span className="num">#{st.next.projectId}</span>「{st.next.title}」</Link></p>}
    </div>
  );
}
