// アプリの中のブラウザの確かめ用ページ（/inapp-check）の、枠の中の試しのツール
// - #72（ふって、しずめる）の「ふる」と同じ大きさ・位置（下の真ん中・下から14px）のボタンを置く
// - 枠の下の端からの高さの目盛り（10px ごと・左に数字）を引き、アプリの帯がどこまで重なるかを、スクリーンショットで読めるようにする
// - 枠の中で測った画面の高さの単位（100dvh・100vh・100svh・100lvh）も出す。#72 は枠の中で 100dvh を高さにしていて、
//   X のアプリの中のブラウザで「ふる」が枠の下にはみ出した。枠の中の単位が、枠ではなく外の画面の高さになっていないかを確かめる
//   （ページの上の情報の欄に隠れないよう、文は枠の真ん中より少し上に置く）
export const CHECK_TOOL_HTML = `<style>
html,body{margin:0;height:100%;background:#0e1a3a;color:#fff;font:12px/1.5 system-ui,sans-serif;overflow:hidden}
#r{position:absolute;left:0;right:0;bottom:0;height:200px;pointer-events:none}
.l{position:absolute;left:0;width:46%;border-top:1px solid rgba(255,255,255,.35)}
.l.m{border-top-color:#ffcf73;width:60%}
.l span{position:absolute;left:4px;top:-9px;font-size:11px;font-weight:700;background:#0e1a3a;padding:0 3px}
#btn{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);min-width:170px;min-height:56px;border-radius:999px;border:1.5px solid rgba(255,255,255,.6);background:rgba(240,244,255,.2);color:#fff;font-size:20px;font-weight:700;letter-spacing:.4em;padding-left:.4em}
#h{position:absolute;top:38%;left:12px;right:12px;text-align:center;color:#dfe5f3}
#u{margin-top:6px;font-size:13px;color:#ffcf73}
.p{position:fixed;left:0;top:0;width:1px;visibility:hidden;pointer-events:none}
</style>
<div id="h">枠の高さ <b id="hv"></b>px<br>左の目盛りは「枠の下の端から」の高さ（px）。アプリの帯がどこまで重なるかを見てください<div id="u"></div></div>
<div class="p" id="p-dvh" style="height:100dvh"></div><div class="p" id="p-vh" style="height:100vh"></div><div class="p" id="p-svh" style="height:100svh"></div><div class="p" id="p-lvh" style="height:100lvh"></div><div class="p" id="p-pct" style="position:absolute;height:100%"></div>
<div id="r"></div>
<button id="btn" type="button">ふる</button>
<script>
var r=document.getElementById("r");
for(var y=0;y<=200;y+=10){var d=document.createElement("div");d.className="l"+(y%50===0?" m":"");d.style.bottom=y+"px";if(y%20===0)d.innerHTML="<span>"+y+"</span>";r.appendChild(d)}
function h(id){var e=document.getElementById(id);return e?Math.round(e.getBoundingClientRect().height):0}
function u(){document.getElementById("hv").textContent=String(innerHeight);document.getElementById("u").textContent="枠の中で測った高さ: 100% "+h("p-pct")+" / 100dvh "+h("p-dvh")+" / 100vh "+h("p-vh")+" / 100svh "+h("p-svh")+" / 100lvh "+h("p-lvh")+"（px）"}
u();addEventListener("resize",u);setInterval(u,1000);
document.getElementById("btn").addEventListener("click",function(){this.textContent=this.textContent==="ふる"?"押せた":"ふる"});
</script>`;
