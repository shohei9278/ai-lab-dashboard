// ツール本体を、隔離された枠に入れるページの形にする。公開サイト・プレビュー・公開前の自動テストで同じものを使う
// - CSP で外部への通信や外部ファイルの読み込みを止める
// - 枠の高さと「使われたか」は、こちらで差し込む小さなスクリプトが知らせる（ツールの中身に頼らない）
//   「使った」は、ボタンなどの押せる所を押した・入力欄や選択肢を変えたときだけ（スクロールで触れただけでは数えない）
//   入力欄・選択肢・ラベルは、押しただけでは数えない（中身を変えたときに input・change で数える）
// - ツールは結果が出たら window.labShare("…") で、シェアの文に使う結果の一文を知らせられる
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
const BRIDGE = `<script>(function(){var u=false;function h(){parent.postMessage({__lab:"height",h:Math.ceil(document.documentElement.scrollHeight)},"*")}
function use(){if(u)return;u=true;parent.postMessage({__lab:"use"},"*")}
window.labShare=function(t){if(typeof t==="string"&&t.trim())parent.postMessage({__lab:"share-text",text:t.trim().slice(0,200)},"*")};
addEventListener("load",h);if(window.ResizeObserver){new ResizeObserver(h).observe(document.documentElement)}setTimeout(h,300);
var T="button,a,summary,canvas,[role=button],[role=tab],[role=option],[role=slider],[onclick]";var F="input,select,textarea,label";
addEventListener("click",function(e){var t=e.target;if(!t||!t.closest||t.closest(F))return;if(t.closest(T)||getComputedStyle(t).cursor==="pointer")use()},true);
addEventListener("input",use,true);addEventListener("change",use,true);})();</script>`;

export function wrapToolHtml(html: string): string {
  // [hidden] は、クラスで display を決めた要素にも効くようにする（付けても消えず、切り替えの入力欄が出たままになっていた）
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>[hidden]{display:none!important}</style>`;
  return `<!doctype html><html lang="ja"><head>${head}</head><body>${html}${BRIDGE}</body></html>`;
}

