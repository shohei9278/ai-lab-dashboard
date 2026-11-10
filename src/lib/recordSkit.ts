import fs from "node:fs";
import path from "node:path";

// ロボット社員の寸劇の描画（ブラウザで動かして録画する）。ロボットはこの実験用のオリジナルの絵で、各社のロゴは使わない
// 体は生成した画像（public/robots）で、黒い画面の上に目と口のLEDを重ねて表情を付ける
export const MOODS = ["normal", "surprised", "thinking", "down", "angry", "happy"] as const;
export type Mood = (typeof MOODS)[number];
export type SkitCast = { name: string; provider: string };
export type SkitBeat = { speaker: number; line: string; mood: Mood; board?: string };

const COLOR: Record<string, string> = { anthropic: "#f08a2a", openai: "#58cfa6", google: "#5aa9f0" };
// 画像の中の黒い画面の位置（%）
const FACE: Record<string, { cx: number; cy: number; w: number; h: number }> = {
  anthropic: { cx: 49.5, cy: 35.6, w: 64, h: 31 },
  openai: { cx: 49.5, cy: 41, w: 65, h: 31 },
  google: { cx: 51, cy: 42, w: 66, h: 30 },
};

const imageUrl = (provider: string) => `data:image/webp;base64,${fs.readFileSync(path.join(process.cwd(), "public", "robots", `${provider}.webp`)).toString("base64")}`;

function robot(provider: string): string {
  const f = FACE[provider] ?? FACE.anthropic;
  return `<img src="${imageUrl(FACE[provider] ? provider : "anthropic")}" alt=""><div class="face" style="left:${f.cx - f.w / 2}%;top:${f.cy - f.h / 2}%;width:${f.w}%;height:${f.h}%"><i class="eye l"></i><i class="eye r"></i><i class="mouth"></i></div>`;
}

export function skitHtml(data: { cast: SkitCast[]; beats: SkitBeat[] }): string {
  const bots = data.cast.map((c, i) => `<div class="bot" id="b${i}" style="--c:${COLOR[c.provider] ?? "#9aa0aa"}"><div class="body">${robot(c.provider)}</div><div class="name" id="n${i}"></div></div>`).join("");
  // 文字はすべて textContent で入れる
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}html{zoom:2}html,body{width:540px;height:960px;overflow:hidden;background:#12161e;color:#f4f4f2;font-family:"Hiragino Sans","Noto Sans CJK JP",sans-serif}
#floor{position:absolute;left:0;right:0;bottom:0;height:320px;background:linear-gradient(#232936,#171b24)}
#tag{position:absolute;top:30px;width:100%;text-align:center;font-size:19px;font-weight:700;color:#a7abb3}
#board{position:absolute;top:66px;left:24px;right:24px;height:205px;border-radius:14px;background:#0b0e13;border:5px solid #39404e;display:flex;align-items:center;justify-content:center;text-align:center;padding:18px;font-size:48px;font-weight:800;line-height:1.3;color:#ffd166}
#board span{transition:opacity .2s}
#bubble{position:absolute;top:296px;left:24px;right:24px;min-height:210px;border-radius:22px;background:#f7f7f4;color:#14181f;padding:18px 22px;opacity:0;transition:opacity .16s}
#bubble:after{content:"";position:absolute;bottom:-26px;left:var(--tail,50%);margin-left:-18px;border:18px solid transparent;border-top:26px solid #f7f7f4;border-bottom:0}
#who{font-size:21px;font-weight:800;margin-bottom:8px}#line{font-size:34px;font-weight:800;line-height:1.42;white-space:pre-wrap}
#stage{position:absolute;left:0;right:0;bottom:112px;display:flex;justify-content:space-around;align-items:flex-end;padding:0 10px}
.bot{width:170px;display:flex;flex-direction:column;align-items:center;transition:opacity .2s,transform .22s;filter:saturate(.95)}.bot.dim{opacity:.62;filter:saturate(.55)}.bot.on{transform:translateY(-14px) scale(1.09)}
.body{position:relative;height:262px;transform-origin:50% 92%}.body img{height:100%;display:block}.bot.on .body img{filter:drop-shadow(0 0 16px var(--c))}
.bot:after{content:"";order:1;width:120px;height:14px;border-radius:50%;background:#0006;margin-top:-6px}.name{order:2;font-size:17px;font-weight:700;margin-top:6px;color:#e4e7ec}
.face{position:absolute;--led:#8df3ff}.eye,.mouth{position:absolute;display:block;background:var(--led);box-shadow:0 0 8px var(--led),0 0 18px var(--led);transition:all .14s}
.eye{top:27%;width:20%;height:38%;border-radius:50%;animation:blink 3.4s infinite}.eye.l{left:20%}.eye.r{right:20%}.eye.r{animation-delay:.02s}
@keyframes blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.08)}}
.mouth{left:38%;width:24%;top:74%;height:8%;border-radius:6px}.bot.talk .mouth{animation:talk .15s infinite alternate}
@keyframes talk{to{top:68%;height:22%;border-radius:12px}}
.surprised .body{animation:jump .42s 2}.surprised .eye{top:20%;height:50%;width:25%;animation:none}.surprised .mouth{left:43%;width:14%;top:72%;height:16%;border-radius:50%}@keyframes jump{50%{transform:translateY(-34px)}}
.angry .body{animation:shake .12s 10}.angry .face{--led:#ff7d6e}.angry .eye{top:36%;height:24%;animation:none;border-radius:4px}.angry .eye.l{transform:rotate(18deg)}.angry .eye.r{transform:rotate(-18deg)}@keyframes shake{25%{transform:translateX(-7px) rotate(-3deg)}75%{transform:translateX(7px) rotate(3deg)}}
.down .body{transform:rotate(7deg) translateY(12px);transition:transform .3s}.down .face{--led:#6fb7c9}.down .eye{top:47%;height:10%;animation:none;border-radius:4px}.down .mouth{left:43%;width:14%;height:5%}
.thinking .body{transform:rotate(-8deg);transition:transform .3s}.thinking .eye{animation:none;transform:translate(26%,-20%)}.thinking .mouth{left:50%;width:12%;height:6%}
.happy .body{animation:hop .3s 4}@keyframes hop{50%{transform:translateY(-22px) rotate(3deg)}}.happy .eye{animation:none;background:transparent;box-shadow:none;height:34%;top:34%;border-top:6px solid var(--led);border-radius:50%;filter:drop-shadow(0 0 6px var(--led))}.happy .mouth{left:38%;width:24%;height:16%;border-radius:0 0 40px 40px}
</style><div id="floor"></div><div id="tag">AIを社員にした会社の実験</div><div id="board"><span id="bt"></span></div><div id="bubble"><div id="who"></div><div id="line"></div></div><div id="stage">${bots}</div>
<script>
const D=${JSON.stringify(data).replace(/</g, "\\u003c")};
D.cast.forEach((c,i)=>{document.getElementById('n'+i).textContent=c.name;});
const bt=document.getElementById('bt'),bub=document.getElementById('bubble'),who=document.getElementById('who'),line=document.getElementById('line');
const cls=['talk','on','dim','normal','surprised','thinking','down','angry','happy'];
window.show=(i)=>new Promise(done=>{const b=D.beats[i];
 if(b.board){bt.style.opacity=0;setTimeout(()=>{bt.textContent=b.board;bt.style.opacity=1;},200);}
 D.cast.forEach((c,k)=>{const e=document.getElementById('b'+k);e.classList.remove(...cls);if(b.speaker>=0)e.classList.add(k===b.speaker?'on':'dim');});
 if(b.speaker<0||!b.line){bub.style.opacity=0;return setTimeout(done,240);}
 const e=document.getElementById('b'+b.speaker);e.classList.add('talk',b.mood);
 bub.style.setProperty('--tail',((b.speaker+.5)/D.cast.length*100)+'%');who.textContent=D.cast[b.speaker].name;who.style.color=getComputedStyle(e).getPropertyValue('--c');line.textContent='';bub.style.opacity=1;
 const ch=[...b.line];let n=0;const iv=setInterval(()=>{line.textContent=ch.slice(0,++n).join('');if(n>=ch.length){clearInterval(iv);e.classList.remove('talk');done();}},42);
});
</script>`;
}
