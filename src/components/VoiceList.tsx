import Link from "next/link";
import { db } from "@/lib/db";
import { jstDateTime } from "@/lib/format";
import { modelInfo } from "@/lib/models";
import type { VoiceRow } from "@/lib/voices";
import { PromoteVoice } from "@/app/plan/PlanActions";

// 社員の声を、SNSのタイムライン風に並べる（会議室・ホーム・案件の画面・公開ページで使う）
// いいねの数などの作った数字は出さない

const AVATAR: Record<string, string> = { anthropic: "C", openai: "G", google: "Gm" };

// 「3分前」「5時間前」、1日以上たったら日時
function ago(at: string): string {
  const min = Math.floor((Date.now() - Date.parse(at.replace(" ", "T") + "Z")) / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}時間前`;
  return jstDateTime(at);
}

export function VoiceList({ voices, owner, compact = false }: { voices: VoiceRow[]; owner: boolean; compact?: boolean }) {
  if (!voices.length) return <p className="p-4 text-sm text-ink-2">まだ声はありません。AIが作業をすると、ここにつぶやきが流れます。</p>;
  const titles = new Map((db().prepare("SELECT id, title FROM projects").all() as { id: number; title: string }[]).map((p) => [p.id, p.title]));
  return (
    <ul className="divide-y divide-line">
      {voices.map((v) => {
        const m = v.model_id ? modelInfo(v.model_id) : null;
        const color = m ? `var(--series-${m.provider})` : "var(--muted)";
        return (
          <li key={v.id} className={`flex gap-3 ${compact ? "py-2.5" : "px-1 py-3.5"}`}>
            {/* アイコン */}
            <span
              aria-hidden
              className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${compact ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm"}`}
              style={{ background: color }}
            >
              {m ? AVATAR[m.provider] ?? m.label.slice(0, 1) : "S"}
            </span>
            <div className="min-w-0 flex-1">
              {/* 名前・ID・時刻 */}
              <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm leading-tight">
                <span className="font-bold">{m?.label ?? "システム"}</span>
                <span className="text-xs text-muted">@{v.model_id ?? "system"}</span>
                <span className="text-xs text-muted">·</span>
                <time className="num text-xs text-muted" dateTime={v.at.replace(" ", "T") + "Z"} title={jstDateTime(v.at)}>{ago(v.at)}</time>
              </div>
              {/* 本文 */}
              <p className={`mt-1 whitespace-pre-wrap break-words ${compact ? "text-sm" : "text-[15px] leading-relaxed"}`}>{v.text}</p>
              {/* 場面と案件（ハッシュタグ風） */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span style={{ color }}>#{v.scene.replace(/[（）()\s]/g, "")}</span>
                {v.project_id && (
                  <Link href={`/projects/${v.project_id}`} className="rounded-full border border-line px-2 py-0.5 text-ink-2 hover:text-ink">
                    {titles.get(v.project_id) ?? `#${v.project_id}`}
                  </Link>
                )}
                {owner && !compact && (
                  <span className="ml-auto text-ink-2">
                    {v.request_id ? <span className="text-muted">✓ 提案箱に入れた</span> : <PromoteVoice id={v.id} />}
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
