// ツールを書くAIに、そのまま使わせる確かめ済みの部品（tests/core.test.ts でこの文字列を実際に動かして確かめている）
// canvas で画像を作るツールは毎回、角丸や文字の縮小・折り返しを手書きし、同じ崩れ方をしていた（提案箱: canvas共通部品の見本）
// 本番のビルドで名前が書き換わらないよう、関数ではなく文字列で持つ
// - roundRectPath: 角丸の四角形の形を作る（塗る・線を引くのは呼んだ側）。半径は幅・高さの半分までに収める
// - fitFontSize: 1行が幅に収まるまで文字を小さくする（最小の大きさで止める）。決まった大きさを返し、ctx.font もその大きさにする
// - wrapLines: 幅で折り返した行の配列を返す（1文字ずつ。改行はそのまま）。最大行数を超えたら最後の行を「…」で切る
export const CANVAS_HELPERS_JS = `function roundRectPath(ctx, x, y, w, h, r) {
  var rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function fitFontSize(ctx, text, maxWidth, size, minSize, font) {
  font = font || "bold {size}px sans-serif";
  var s = size;
  for (; s > minSize; s--) {
    ctx.font = font.replace("{size}", String(s));
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  ctx.font = font.replace("{size}", String(s));
  return s;
}
function wrapLines(ctx, text, maxWidth, maxLines) {
  if (maxLines === undefined) maxLines = Infinity;
  var lines = [], line = "";
  for (var ch of text) {
    if (ch === "\\n") { lines.push(line); line = ""; continue; }
    if (line && ctx.measureText(line + ch).width > maxWidth) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  var kept = lines.slice(0, maxLines), last = kept[maxLines - 1];
  while (last && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = last + "…";
  return kept;
}`;
