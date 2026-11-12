import { ROBOT_FACE } from "@/lib/robotFace";
import type { Member } from "@/lib/officeShared";

// ロボット社員（動画の寸劇と同じ絵）。黒い画面の上に、目と口の光を重ねて表情を付ける
// mood: work = 作業中（まばたき）/ talk = 話している（口が動く）/ rest = 休憩中（眠そうな目）/ alert = 提案（目を見開く）/ happy = うれしい（笑った目）
export type RobotMood = "work" | "talk" | "rest" | "alert" | "happy";

export const ROBOT_CSS = `
.rb{position:relative;display:block;height:var(--rb-h,52px)}
.rb img{height:100%;display:block;pointer-events:none;user-select:none}
.rb-face{position:absolute;--led:#8df3ff}
.rb-eye,.rb-mouth{position:absolute;display:block;background:var(--led);box-shadow:0 0 4px var(--led),0 0 9px var(--led);transition:all .15s}
.rb-eye{top:27%;width:20%;height:38%;border-radius:50%;animation:rb-blink 3.4s infinite}.rb-eye.l{left:20%}.rb-eye.r{right:20%}
@keyframes rb-blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.08)}}
.rb-mouth{left:38%;width:24%;top:74%;height:8%;border-radius:4px}
.rb.talk .rb-mouth{animation:rb-talk .16s infinite alternate}@keyframes rb-talk{to{top:68%;height:22%;border-radius:8px}}
.rb.rest .rb-face{--led:#6fb7c9}.rb.rest .rb-eye{top:47%;height:10%;animation:none;border-radius:3px}.rb.rest .rb-mouth{left:43%;width:14%;height:5%}
.rb.alert .rb-eye{top:20%;height:50%;width:25%;animation:none}.rb.alert .rb-mouth{left:43%;width:14%;top:72%;height:16%;border-radius:50%}
.rb.happy .rb-eye{animation:none;background:transparent;box-shadow:none;height:34%;top:34%;border-top:3px solid var(--led);border-radius:50%;filter:drop-shadow(0 0 3px var(--led))}.rb.happy .rb-mouth{left:38%;width:24%;height:16%;border-radius:0 0 20px 20px}
`;

export function Robot({ member, mood }: { member: Member; mood: RobotMood }) {
  const f = ROBOT_FACE[member];
  return (
    <span className={`rb ${mood}`} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/robots/${member}.webp`} alt="" draggable={false} />
      <span className="rb-face" style={{ left: `${f.cx - f.w / 2}%`, top: `${f.cy - f.h / 2}%`, width: `${f.w}%`, height: `${f.h}%` }}>
        <i className="rb-eye l" />
        <i className="rb-eye r" />
        <i className="rb-mouth" />
      </span>
    </span>
  );
}
