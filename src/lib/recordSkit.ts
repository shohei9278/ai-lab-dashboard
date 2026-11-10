// ロボット社員の寸劇の描画（ブラウザで動かして録画する）。ロボットはこの実験用のオリジナルの絵で、各社のロゴは使わない
export const MOODS = ["normal", "surprised", "thinking", "down", "angry", "happy"] as const;
export type Mood = (typeof MOODS)[number];
export type SkitCast = { name: string; provider: string };
export type SkitBeat = { speaker: number; line: string; mood: Mood; board?: string };

const COLOR: Record<string, string> = { anthropic: "#e0895a", openai: "#35b48c", google: "#5b8def" };

// 会社ごとに頭の形とアンテナを変える
function robot(provider: string): string {
  const c = COLOR[provider] ?? "#9aa0aa";
  const head = provider === "openai"
    ? `<polygon points="80,34 134,62 134,122 80,150 26,122 26,62" fill="${c}"/>`
    : provider === "google"
      ? `<circle cx="80" cy="92" r="60" fill="${c}"/>`
      : `<rect x="24" y="38" width="112" height="108" rx="26" fill="${c}"/>`;
  const antenna = provider === "google"
    ? `<path d="M80 6 l6 12 13 2 -10 9 3 13 -12-7 -12 7 3-13 -10-9 13-2z" fill="#ffd166"/>`
    : `<rect x="76" y="14" width="8" height="24" fill="#c9ced6"/><circle cx="80" cy="12" r="9" fill="${provider === "openai" ? "#7cf0c8" : "#ffd166"}"/>`;
  return `<svg viewBox="0 0 160 230" width="150" height="216" aria-hidden="true">${antenna}${head}
    <rect x="36" y="66" width="88" height="44" rx="20" fill="#14181f"/>
    <g class="eyes"><circle class="eye" cx="60" cy="88" r="9" fill="#e9f7ff"/><circle class="eye" cx="100" cy="88" r="9" fill="#e9f7ff"/></g>
    <rect class="mouth" x="62" y="122" width="36" height="8" rx="4" fill="#14181f"/>
    <rect x="46" y="158" width="68" height="54" rx="12" fill="#c9ced6"/><rect x="58" y="172" width="44" height="10" rx="5" fill="${c}"/>
    <rect x="14" y="164" width="24" height="12" rx="6" fill="#9aa0aa"/><rect x="122" y="164" width="24" height="12" rx="6" fill="#9aa0aa"/></svg>`;
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
#stage{position:absolute;left:0;right:0;bottom:118px;display:flex;justify-content:space-around;align-items:flex-end;padding:0 10px}
.bot{width:160px;display:flex;flex-direction:column;align-items:center;transition:opacity .2s,transform .22s}.bot.dim{opacity:.5}.bot.on{transform:translateY(-16px) scale(1.1)}
.bot.on svg{filter:drop-shadow(0 0 16px var(--c))}.name{font-size:17px;font-weight:700;margin-top:4px;color:#d7dae0}
.body{transform-origin:50% 90%}.bot.talk .mouth{animation:talk .16s infinite alternate;transform-box:fill-box;transform-origin:center}
@keyframes talk{to{transform:scaleY(3.2)}}
.surprised .body{animation:jump .42s 2}.surprised .eye{transform-box:fill-box;transform-origin:center;transform:scale(1.5)}@keyframes jump{50%{transform:translateY(-34px)}}
.angry .body{animation:shake .12s 10}.angry .eye{fill:#ff8a7a}@keyframes shake{25%{transform:translateX(-7px) rotate(-3deg)}75%{transform:translateX(7px) rotate(3deg)}}
.down .body{transform:rotate(8deg) translateY(14px);transition:transform .3s}.down .eye{transform-box:fill-box;transform-origin:center;transform:scaleY(.3)}
.thinking .body{transform:rotate(-9deg);transition:transform .3s}.thinking .eyes{transform:translate(8px,-5px)}
.happy .body{animation:hop .3s 4}@keyframes hop{50%{transform:translateY(-22px) rotate(3deg)}}
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
