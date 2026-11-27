import { toolImagesOf, type ToolImages } from "./content";
import { TOOL_STORE_MAX } from "./toolStore";

// ツール本体を、隔離された枠に入れるページの形にする。公開サイト・プレビュー・公開前の自動テストで同じものを使う
// - CSP で外部への通信や外部ファイルの読み込みを止める
// - 枠の高さと「使われたか」は、こちらで差し込む小さなスクリプトが知らせる（ツールの中身に頼らない）
//   高さは、親のページが受け取れるようになってから聞き直す（{__lab:"ping"}）と、もう一度知らせる
//   （ページの準備より先に枠が読み込まれると、最初の知らせを取りこぼして、枠が初めの高さのまま下が切れていた）
//   「使った」は、ボタンなどの押せる所を押した・入力欄や選択肢を変えたときだけ（スクロールで触れただけでは数えない）
//   入力欄・選択肢・ラベルは、押しただけでは数えない（中身を変えたときに input・change で数える）
//   触った・押した・ドラッグした・キーを押したことは、1秒に1回まで {__lab:"active"} で知らせる（遊んだ時間を測るため。playDepth.ts）
// - ツールの中で起きたエラー（止まった・Promise の失敗）は、種類（TypeError など）と行の番号だけを {__lab:"error"} で知らせる（1回の表示で違うものを3つまで）
//   本番で来た人の画面でツールが止まっても、これまでは誰も気づけなかった（運営者が決めた）。文は個人の入力を含むことがあるので送らない
//   ツールの読み込み中に起きるエラーも拾えるよう、ツールより前（<head>）で受け取る（ERROR_CATCH）
//   ツールは <body> のすぐあとから始まり、その前は1行なので、行の番号はツールのコードの行の番号と同じになる
// - ツールは結果が出たら window.labShare("…") で、シェアの文に使う結果の一文を知らせられる
// - 結果の種類が決まっているツールは window.labResult(番号) で、どの結果かを知らせられる（シェアのリンクと、結果ごとのシェア画像に使う）
// - どちらも2つ目に { quiet: true } を付けると、シェアの文と番号だけ替え、結果のあとの欄（シェア・ほかの遊び）を開かない（遊びが続くツールの途中の結果）
// - 次に開いたときにも残したいものは window.labStore.get()・set(値) で、ページの側に預けられる（toolStore.ts）
//   ページが答えないとき（公開前の自動テスト・動画の録画など）は、1.5秒で get は null、set は false になる
// - スマホの動きは window.labMotion.request() で許可を頼み、"labmotion" イベント（detail: x・y・z）で受け取る（toolMotion.ts）
//   答えを待っている間に続けて頼まれたら、同じ答えを待たせる（ページの側に頼みをためない）
//   ページの側で許可を求めるので、iPhone でも使える。ページが答えないときは 20秒で "unavailable"
// fonts: Google Fonts を使ってよいとき、読み込めるのはその2か所の CSS と文字の形だけ
// imgOrigins: このツールの紹介イラストと、人が入れた画像（素材）を置いている場所（https のときだけ。画像の読み込みだけを許す）。ほかへの通信は止めたまま
function csp(fonts: boolean, imgOrigins: string[]): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    `style-src 'unsafe-inline'${fonts ? " https://fonts.googleapis.com" : ""}`,
    `img-src data: blob:${imgOrigins.map((o) => ` ${o}`).join("")}`,
    `font-src data:${fonts ? " https://fonts.gstatic.com" : ""}`,
    "media-src data: blob:",
  ].join("; ");
}
// https の URL から、場所（https://host）だけを取り出す。おかしな URL は使わない
function originOf(url: string | undefined): string | null {
  if (!url || !/^https:\/\/[^\s"'<>]+$/.test(url)) return null;
  try { return new URL(url).origin; } catch { return null; }
}
// ツールの中で起きたエラーを、種類と行の番号だけ知らせる（改行を入れない。入れると、ツールの行の番号がずれる）
// Promise の失敗は、エラーの経路（stack）から about:srcdoc の行の番号だけを取り出す（経路の文は送らない。取り出せなければ 0）
// ページが受け取れるようになる前に起きたエラーは、ページの {__lab:"ping"} でもう一度送る（同じものはページの側で1回にする。PR #125 の ai-review の指摘）
const ERROR_CATCH = `<script>(function(){var ec=0,es={},q=[];function er(n,l){n=String(n||"Error").replace(/[^A-Za-z]/g,"").slice(0,20)||"Error";l=Math.max(0,Math.floor(Number(l)||0));var k=n+l;if(ec>=3||es[k]||parent===window)return;es[k]=1;ec++;var m={__lab:"error",name:n,line:l};q.push(m);parent.postMessage(m,"*")}function ln(r){var m=/about:srcdoc:(\\d+):\\d+/.exec(r&&r.stack?String(r.stack):"");return m?m[1]:0}addEventListener("error",function(e){if(e.target&&e.target!==window)return;er(e.error&&e.error.name,e.lineno)});addEventListener("unhandledrejection",function(e){var r=e.reason;er(r&&r.name?r.name:"Rejection",ln(r))});addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.__lab!=="ping")return;for(var i=0;i<q.length;i++)parent.postMessage(q[i],"*")})})()</script>`;

const BRIDGE = `<script>(function(){var u=false;function h(){parent.postMessage({__lab:"height",h:Math.ceil(document.documentElement.scrollHeight)},"*")}
function use(){if(u)return;u=true;parent.postMessage({__lab:"use"},"*")}
window.labShare=function(t,o){if(typeof t==="string"&&t.trim())parent.postMessage({__lab:"share-text",text:t.trim().slice(0,200),quiet:!!(o&&o.quiet)},"*")};
window.labResult=function(i,o){if(typeof i==="number"&&i>=0&&i<100&&Math.floor(i)===i)parent.postMessage({__lab:"result",i:i,quiet:!!(o&&o.quiet)},"*")};
addEventListener("load",h);if(window.ResizeObserver){new ResizeObserver(h).observe(document.documentElement)}setTimeout(h,300);
addEventListener("message",function(e){if(e.source===parent&&e.data&&e.data.__lab==="ping")h()});
var T="button,a,summary,canvas,[role=button],[role=tab],[role=option],[role=slider],[onclick]";var F="input,select,textarea,label";
addEventListener("click",function(e){var t=e.target;if(!t||!t.closest||t.closest(F))return;if(t.closest(T)||getComputedStyle(t).cursor==="pointer")use()},true);
addEventListener("input",use,true);addEventListener("change",use,true);
var la=0;function act(){var n=Date.now();if(n-la<1000)return;la=n;parent.postMessage({__lab:"active"},"*")}["pointerdown","keydown","wheel","touchstart"].forEach(function(t){addEventListener(t,act,{capture:true,passive:true})});addEventListener("pointermove",function(e){if(e.buttons)act()},{capture:true,passive:true});
var sq=0,sw={};addEventListener("message",function(e){var d=e.data;if(e.source!==parent||parent===window||!d)return;if((d.__lab==="store"||d.__lab==="motion-state")&&sw[d.id]){var f=sw[d.id];delete sw[d.id];f(d)}
if(d.__lab==="motion"&&typeof d.x==="number")dispatchEvent(new CustomEvent("labmotion",{detail:{x:d.x,y:d.y,z:d.z}}))});
var mp=null;window.labMotion={request:function(){if(mp)return mp;mp=new Promise(function(ok){if(parent===window){ok("unavailable");return}var id=++sq,t=setTimeout(function(){delete sw[id];ok("unavailable")},20000);sw[id]=function(d){clearTimeout(t);ok(d.state==="granted"||d.state==="denied"?d.state:"unavailable")};parent.postMessage({__lab:"motion-request",id:id},"*")});mp.then(function(){mp=null});return mp}};
function sreq(m){return new Promise(function(ok){if(parent===window){ok(null);return}var id=++sq,t=setTimeout(function(){delete sw[id];ok(null)},1500);sw[id]=function(d){clearTimeout(t);ok(d)};m.id=id;parent.postMessage(m,"*")})}
window.labStore={get:function(){return sreq({__lab:"store-get"}).then(function(d){if(!d||!d.ok||typeof d.value!=="string")return null;try{return JSON.parse(d.value)}catch(x){return null}})},
set:function(v){var s;try{s=JSON.stringify(v)}catch(x){return Promise.resolve(false)}if(typeof s!=="string"||s.length>${TOOL_STORE_MAX})return Promise.resolve(false);return sreq({__lab:"store-set",value:s}).then(function(d){return !!(d&&d.ok)})}};})();</script>`;

// data: じっくり案件の、人が確かめたデータ。ツールより先に window.labData として置く（通信せずに読める）
// fonts: Google Fonts を使ってよいか
// illustration: このツールの紹介イラストの URL。window.labAssets.illustration として置き、その場所の画像だけ読み込めるようにする
// images: じっくり案件で人が入れた画像（素材）。window.labAssets.images（名前 → URL）として置き、その場所の画像だけ読み込めるようにする
//   画像の保存領域は、ほかのページからの読み込みを許しているので、crossOrigin="anonymous" で読めば canvas・WebGL にも描ける（描いたあとも画像を保存できる）
// fill: 枠を画面の高さに決めて出すとき（遊びのツールの全画面。ShortToolView）。枠の中で引っぱりきっても、外のページが動いたり読み込み直されたりしないようにする
//   canvas の上で指を動かしても、枠の中がスクロールしないようにする（提案箱 #113。#73 で、丸を描く途中に枠の中が上下にずれて描きにくかった）
//   ツールより先に置く無名の @layer に入れて、ツールが自分で touch-action を決めたときは、レイヤーの中でも外でも、そちらを使う
//   （:where で重みを 0 にするだけだと、ツールが @layer の中で決めた指定に負けない。PR #215 のレビューの指摘）
export function wrapToolHtml(html: string, opts: { data?: unknown[]; fonts?: boolean; illustration?: string; images?: ToolImages; fill?: boolean } = {}): string {
  const imgOrigin = originOf(opts.illustration);
  const images = toolImagesOf(opts.images, true);
  const imgOrigins = [...new Set([imgOrigin, ...Object.values(images ?? {}).map(originOf)].filter((o): o is string => !!o))];
  // [hidden] は、クラスで display を決めた要素にも効くようにする（付けても消えず、切り替えの入力欄が出たままになっていた）
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp(!!opts.fonts, imgOrigins)}"><style>[hidden]{display:none!important}${opts.fill ? "html,body{overscroll-behavior:none}@layer{canvas{touch-action:none}}" : ""}</style>`;
  // データの中の文字で </script> を閉じられないように、< と行区切りの文字を書き換える
  const data = opts.data ? `<script>window.labData=${JSON.stringify(opts.data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")};</script>` : "";
  const assets = `<script>window.labAssets=${JSON.stringify({ ...(imgOrigin ? { illustration: opts.illustration } : {}), ...(images ? { images } : {}) }).replace(/</g, "\\u003c")};</script>`;
  return `<!doctype html><html lang="ja"><head>${head}${ERROR_CATCH}${data}${assets}</head><body>${html}${BRIDGE}</body></html>`;
}

