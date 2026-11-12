// オフィスの画面（試作）で、サーバーと画面の両方が使う部分（データベースには触れない）
// 時刻はすべて UTC の "YYYY-MM-DD HH:MM:SS"

export type Member = "anthropic" | "openai" | "google";
export const MEMBERS: { id: Member; name: string }[] = [
  { id: "anthropic", name: "Claude" },
  { id: "openai", name: "GPT" },
  { id: "google", name: "Gemini" },
];

export type Room = "dev" | "meeting" | "pr" | "lounge";
export const ROOMS: Record<Room, string> = { dev: "開発室", meeting: "会議室", pr: "広報デスク", lounge: "休憩室" };

export type OfficeEvent = { at: string; member: Member; room: Room; doing: string; project: string | null };
export type OfficeLine = { at: string; member: Member; kind: "voice" | "proposal"; text: string };

// ある時刻に、各社員がどの部屋にいて何をしているか（その時刻から3分以内に呼んだ記録があれば、その部屋。なければ休憩室）
export const ACTIVE_SECONDS = 180;
export const toMs = (s: string) => Date.parse(s.replace(" ", "T") + "Z");
export type MemberState = { room: Room; doing: string | null; project: string | null };
export function stateAt(events: OfficeEvent[], at: string): Record<Member, MemberState> {
  const t = toMs(at);
  const out = {} as Record<Member, MemberState>;
  for (const m of MEMBERS) {
    let last: OfficeEvent | undefined;
    for (const e of events) if (e.member === m.id && toMs(e.at) <= t) last = e;
    const active = last && t - toMs(last.at) <= ACTIVE_SECONDS * 1000;
    out[m.id] = active && last ? { room: last.room, doing: last.doing, project: last.project } : { room: "lounge", doing: null, project: null };
  }
  return out;
}
