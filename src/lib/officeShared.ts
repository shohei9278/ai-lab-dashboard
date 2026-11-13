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

// talk: AIを呼んだ記録ではなく、AIの会話（発言）から作った動き。話している間もその部屋にいるようにするためで、回数と費用には数えない
export type OfficeEvent = { at: string; member: Member; room: Room; doing: string; project: string | null; projectId: number | null; yen: number; talk?: boolean };
// 案件の展示（公開中・保留・育てる段階と、7日以内に撤退した案件）
export type OfficeShop = { id: number; title: string; kind: "lp" | "tool"; status: "open" | "hold" | "growing" | "closed"; visitsToday: number; convToday: number };
// 「公開中」として数える案件（集客中と、育てる段階。保留と受付終了は数えない。ホームの「公開・集客中」と同じ考え方）
export const isOpenShop = (s: OfficeShop) => s.status === "open" || s.status === "growing";
// 会社全体の出来事（公開・撤退・続ける）。画面の上に演出として出す
export type OfficeHappening = { at: string; kind: "publish" | "close" | "grow"; title: string | null };
export const HAPPENING: Record<OfficeHappening["kind"], { label: string }> = {
  publish: { label: "を公開しました" },
  close: { label: "の受付を終えました" },
  grow: { label: "を育てる段階に進めました" },
};
// 社員の発言: voice = 社員の声（日報のつぶやき）/ proposal = 提案箱への提案 は吹き出しに出す
// talk = ライブの「AIの会話」（提案・採点・判断・議論など。about は何の発言か）は長いので吹き出しには出さず、
// 話している表情と、社員を押したときの「最近の発言」に使う（一覧はオフィスの下のライブの欄）
export type OfficeLine = { at: string; member: Member; kind: "voice" | "proposal" | "talk"; text: string; about?: string; project?: string | null };

// ある時刻に、各社員がどの部屋にいて何をしているか（その時刻から3分以内に呼んだ記録があれば、その部屋。なければ休憩室）
export const ACTIVE_SECONDS = 180;
export const toMs = (s: string) => Date.parse(s.replace(" ", "T") + "Z");
export type MemberState = { room: Room; doing: string | null; project: string | null; projectId: number | null; since: string | null };
export function stateAt(events: OfficeEvent[], at: string): Record<Member, MemberState> {
  const t = toMs(at);
  const out = {} as Record<Member, MemberState>;
  for (const m of MEMBERS) {
    let last: OfficeEvent | undefined;
    for (const e of events) if (e.member === m.id && toMs(e.at) <= t) last = e;
    const active = last && t - toMs(last.at) <= ACTIVE_SECONDS * 1000;
    out[m.id] = active && last ? { room: last.room, doing: last.doing, project: last.project, projectId: last.projectId, since: last.at } : { room: "lounge", doing: null, project: null, projectId: null, since: null };
  }
  return out;
}

// その時刻までの、社員ごとの呼んだ回数と費用（その日の日本時間の0時から）
export function tallyAt(events: OfficeEvent[], at: string): Record<Member, { calls: number; yen: number }> {
  const t = toMs(at);
  const dayStart = Math.floor((t + 9 * 3600_000) / 86_400_000) * 86_400_000 - 9 * 3600_000;
  const out = Object.fromEntries(MEMBERS.map((m) => [m.id, { calls: 0, yen: 0 }])) as Record<Member, { calls: number; yen: number }>;
  for (const e of events) {
    const et = toMs(e.at);
    if (e.talk || et < dayStart || et > t) continue;
    out[e.member].calls++;
    out[e.member].yen += e.yen;
  }
  return out;
}
