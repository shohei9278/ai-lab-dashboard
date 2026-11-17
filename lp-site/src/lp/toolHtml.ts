// ツール本体を、隔離された枠に入れるページの形にする。公開サイト・プレビュー・公開前の自動テストで同じものを使う
// - CSP で外部への通信や外部ファイルの読み込みを止める
// - 枠の高さと「使われたか」は、こちらで差し込む小さなスクリプトが知らせる（ツールの中身に頼らない）
//   高さは、親のページが受け取れるようになってから聞き直す（{__lab:"ping"}）と、もう一度知らせる
//   （ページの準備より先に枠が読み込まれると、最初の知らせを取りこぼして、枠が初めの高さのまま下が切れていた）
//   「使った」は、ボタンなどの押せる所を押した・入力欄や選択肢を変えたときだけ（スクロールで触れただけでは数えない）
//   入力欄・選択肢・ラベルは、押しただけでは数えない（中身を変えたときに input・change で数える）
// - ツールは結果が出たら window.labShare("…") で、シェアの文に使う結果の一文を知らせられる
// - 結果の種類が決まっているツールは window.labResult(番号) で、どの結果かを知らせられる（シェアのリンクと、結果ごとのシェア画像に使う）
// fonts: Google Fonts を使ってよいとき、読み込めるのはその2か所の CSS と文字の形だけ
// imgOrigin: このツールの紹介イラストを置いている場所（https のときだけ。画像の読み込みだけを許す）。ほかへの通信は止めたまま
function csp(fonts: boolean, imgOrigin: string | null): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    `style-src 'unsafe-inline'${fonts ? " https://fonts.googleapis.com" : ""}`,
    `img-src data: blob:${imgOrigin ? ` ${imgOrigin}` : ""}`,
    `font-src data:${fonts ? " https://fonts.gstatic.com" : ""}`,
    "media-src data: blob:",
  ].join("; ");
}
// https の URL から、場所（https://host）だけを取り出す。おかしな URL は使わない
function originOf(url: string | undefined): string | null {
  if (!url || !/^https:\/\/[^\s"'<>]+$/.test(url)) return null;
  try { return new URL(url).origin; } catch { return null; }
}
const BRIDGE = `<script>(function(){var u=false;function h(){parent.postMessage({__lab:"height",h:Math.ceil(document.documentElement.scrollHeight)},"*")}
function use(){if(u)return;u=true;parent.postMessage({__lab:"use"},"*")}
window.labShare=function(t){if(typeof t==="string"&&t.trim())parent.postMessage({__lab:"share-text",text:t.trim().slice(0,200)},"*")};
window.labResult=function(i){if(typeof i==="number"&&i>=0&&i<100&&Math.floor(i)===i)parent.postMessage({__lab:"result",i:i},"*")};
addEventListener("load",h);if(window.ResizeObserver){new ResizeObserver(h).observe(document.documentElement)}setTimeout(h,300);
addEventListener("message",function(e){if(e.source===parent&&e.data&&e.data.__lab==="ping")h()});
var T="button,a,summary,canvas,[role=button],[role=tab],[role=option],[role=slider],[onclick]";var F="input,select,textarea,label";
addEventListener("click",function(e){var t=e.target;if(!t||!t.closest||t.closest(F))return;if(t.closest(T)||getComputedStyle(t).cursor==="pointer")use()},true);
addEventListener("input",use,true);addEventListener("change",use,true);})();</script>`;

// data: じっくり案件の、人が確かめたデータ。ツールより先に window.labData として置く（通信せずに読める）
// fonts: Google Fonts を使ってよいか
// illustration: このツールの紹介イラストの URL。window.labAssets.illustration として置き、その場所の画像だけ読み込めるようにする
export function wrapToolHtml(html: string, opts: { data?: unknown[]; fonts?: boolean; illustration?: string } = {}): string {
  const imgOrigin = originOf(opts.illustration);
  // [hidden] は、クラスで display を決めた要素にも効くようにする（付けても消えず、切り替えの入力欄が出たままになっていた）
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp(!!opts.fonts, imgOrigin)}"><style>[hidden]{display:none!important}</style>`;
  // データの中の文字で </script> を閉じられないように、< と行区切りの文字を書き換える
  const data = opts.data ? `<script>window.labData=${JSON.stringify(opts.data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")};</script>` : "";
  const assets = `<script>window.labAssets=${JSON.stringify(imgOrigin ? { illustration: opts.illustration } : {}).replace(/</g, "\\u003c")};</script>`;
  return `<!doctype html><html lang="ja"><head>${head}${data}${assets}</head><body>${html}${BRIDGE}</body></html>`;
}

