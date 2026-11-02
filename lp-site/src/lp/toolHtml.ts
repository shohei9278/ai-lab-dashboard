// ツール本体を、隔離された枠に入れるページの形にする。公開サイト・プレビュー・公開前の自動テストで同じものを使う
// - CSP で外部への通信や外部ファイルの読み込みを止める
// - 枠の高さと「使われたか」は、こちらで差し込む小さなスクリプトが知らせる（ツールの中身に頼らない）
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
const BRIDGE = `<script>(function(){var u=false;function h(){parent.postMessage({__lab:"height",h:Math.ceil(document.documentElement.scrollHeight)},"*")}
function use(){if(u)return;u=true;parent.postMessage({__lab:"use"},"*")}
addEventListener("load",h);if(window.ResizeObserver){new ResizeObserver(h).observe(document.documentElement)}setTimeout(h,300);
addEventListener("pointerdown",use,true);addEventListener("keydown",use,true);})();</script>`;

export function wrapToolHtml(html: string): string {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  return `<!doctype html><html lang="ja"><head>${head}</head><body>${html}${BRIDGE}</body></html>`;
}

