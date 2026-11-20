// アプリの中のブラウザの確かめ用ページ（/inapp-check）の、枠の中の試しのツール
// - #72（ふって、しずめる）の「ふる」と同じ大きさ・位置（下の真ん中・下から14px）のボタンを置く
// - 枠の下の端からの高さの目盛り（10px ごと・左に数字）を引き、アプリの帯がどこまで重なるかを、スクリーンショットで読めるようにする
export const CHECK_TOOL_HTML = `<style>
html,body{margin:0;height:100%;background:#0e1a3a;color:#fff;font:12px/1.5 system-ui,sans-serif;overflow:hidden}
#r{position:absolute;left:0;right:0;bottom:0;height:200px;pointer-events:none}
.l{position:absolute;left:0;width:46%;border-top:1px solid rgba(255,255,255,.35)}
.l.m{border-top-color:#ffcf73;width:60%}
.l span{position:absolute;left:4px;top:-9px;font-size:11px;font-weight:700;background:#0e1a3a;padding:0 3px}
#btn{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);min-width:170px;min-height:56px;border-radius:999px;border:1.5px solid rgba(255,255,255,.6);background:rgba(240,244,255,.2);color:#fff;font-size:20px;font-weight:700;letter-spacing:.4em;padding-left:.4em}
#h{position:absolute;top:10px;left:12px;right:12px;text-align:center;color:#dfe5f3}
</style>
<div id="h">枠の高さ <b id="hv"></b>px<br>左の目盛りは「枠の下の端から」の高さ（px）。アプリの帯がどこまで重なるかを見てください</div>
<div id="r"></div>
<button id="btn" type="button">ふる</button>
<script>
var r=document.getElementById("r");
for(var y=0;y<=200;y+=10){var d=document.createElement("div");d.className="l"+(y%50===0?" m":"");d.style.bottom=y+"px";if(y%20===0)d.innerHTML="<span>"+y+"</span>";r.appendChild(d)}
function u(){document.getElementById("hv").textContent=String(innerHeight)}
u();addEventListener("resize",u);
document.getElementById("btn").addEventListener("click",function(){this.textContent=this.textContent==="ふる"?"押せた":"ふる"});
</script>`;
