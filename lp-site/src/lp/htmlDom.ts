// AIが書いたHTMLを、ブラウザと同じ規則（HTMLの標準の読み方。parse5）で読む
// 自前の正規表現では、script の中の文字列・閉じタグの食い違い・<div/>・文字参照（&#45; など）で、ブラウザと違う形に読んでしまうため
// サーバーでだけ使う（画面のコードに入れると、パーサーの分だけ読み込みが重くなる）
import { parse, parseFragment, serialize, serializeOuter, type DefaultTreeAdapterTypes as T } from "parse5";
import { isToolResults } from "./content";

const isEl = (n: T.Node): n is T.Element => "tagName" in n;
// 文書の中のすべての要素（template の中身はページの要素にならないので入れない。ブラウザの getElementById と同じ）
function elementsOf(root: T.ParentNode): T.Element[] {
  const out: T.Element[] = [];
  const walk = (p: T.ParentNode) => {
    for (const n of p.childNodes) {
      if (!isEl(n)) continue;
      out.push(n);
      walk(n);
    }
  };
  walk(root);
  return out;
}
// 属性の値（文字参照はデコード済み。同じ名前が2つあるときは、ブラウザと同じく最初のもの）
const attrOf = (el: T.Element, name: string) => el.attrs.find((a) => a.name === name && !a.namespace)?.value;
const attrsHtml = (el: T.Element) => el.attrs.map((a) => ` ${a.prefix ? a.prefix + ":" : ""}${a.name}="${a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join("");
const childEl = (p: T.ParentNode, name: string) => p.childNodes.find((n): n is T.Element => isEl(n) && n.tagName === name);

// ツールの案件のページを、ツールを入れる場所 <div id="lab-tool"></div> の前と後に分ける
// 場所（id が lab-tool の要素）がちょうど1つ・body の直下・属性は id だけ・中身なし（空白だけは可）の div のときだけ。それ以外は null
function toolPageParts(html: string): { doc: (inner: string) => string; top: string; bottom: string } | null {
  const document = parse(html);
  const root = childEl(document, "html");
  const head = root && childEl(root, "head");
  const body = root && childEl(root, "body");
  if (!root || !head || !body) return null;
  const slots = elementsOf(document).filter((el) => attrOf(el, "id") === "lab-tool");
  if (slots.length !== 1) return null;
  const slot = slots[0];
  if (slot.tagName !== "div" || slot.parentNode !== body || slot.attrs.length !== 1 || !slot.childNodes.every((n) => n.nodeName === "#text" && !("value" in n && n.value.trim()))) return null;
  const at = body.childNodes.indexOf(slot);
  const outer = (nodes: T.ChildNode[]) => nodes.map((n) => serializeOuter(n)).join("");
  const htmlAttrs = attrsHtml(root) || ' lang="ja"';
  return {
    doc: (inner) => `<!doctype html><html${htmlAttrs}><head>${serialize(head)}</head><body${attrsHtml(body)}>${inner}</body></html>`,
    top: outer(body.childNodes.slice(0, at)),
    bottom: outer(body.childNodes.slice(at + 1)),
  };
}

// ツールの案件のページ: AIが書いたページの body の直下に、ツールを入れる場所 <div id="lab-tool"></div> が1つある
// その前後で、同じ <head>（書体・色の指定）を持つ2つのページに分ける（上の部分 → ツール → 下の部分 の順に、別々の枠で出す）
// 場所が見つからない・2つ以上ある・ほかの要素の中にある・形が違うときは null（ふつうの部品の表示にする）
export function splitToolPage(html: string): { top: string; bottom: string } | null {
  const p = toolPageParts(html);
  return p && { top: p.doc(p.top), bottom: p.doc(p.bottom) };
}
// ツールを入れる場所を、ほかのもの（公開前の撮影の「ここに動くツールが入ります」の箱など）に差し替えた1つのページ
export function fillToolSlot(html: string, middle: string): string | null {
  const p = toolPageParts(html);
  return p && p.doc(p.top + middle + p.bottom);
}

// ツールのページで、運営者名の欄（data-lab="operator" の要素）が、ツールより下の部分に本物の要素としてあるか
// （コメントや script の中の文字は数えない。上の部分にだけあるものも数えない）
export function hasOperatorBelow(html: string): boolean {
  const parts = toolPageParts(html);
  return !!parts && elementsOf(parse(parts.doc(parts.bottom))).some((el) => attrOf(el, "data-lab") === "operator");
}

// 結果の一覧（<script type="application/json" id="lab-results">[...]</script>）を書く場所があるか（data-id などは数えない）
const resultScripts = (html: string) => elementsOf(parse(html)).filter((el) => el.tagName === "script" && attrOf(el, "id") === "lab-results");
export const hasResultsTag = (html: string) => resultScripts(html).length > 0;
// ツールのコードに書かれた結果の一覧を取り出す
// type が application/json でないもの（スクリプトとして動いてしまう）・読めないもの・決まりに合わないものは undefined（番号がずれないよう、そろえ直さない）
// id が lab-results の <script> がちょうど1つのときだけ読む（2つ以上あると、どれが本物か分からない）
export function toolResultsOf(html: string): string[] | undefined {
  const tags = resultScripts(html);
  if (tags.length !== 1) return undefined;
  const tag = tags[0];
  if ((attrOf(tag, "type") ?? "").trim().toLowerCase() !== "application/json") return undefined;
  try {
    const v = JSON.parse(tag.childNodes.map((n) => ("value" in n ? n.value : "")).join("")) as unknown;
    return isToolResults(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

// Claude Code で作ったツールに付けた、遊ぶ様子の動画の台本（<script type="application/json" id="lab-play">{...}</script>）を取り出す
// 公開するツールには入れないので、その要素を除いたツールの HTML（ほかの部分は1文字も変えない）も返す
// 台本の要素がなければ json は null。2つ以上ある・type が application/json でないときは error（どれが本物か分からない・スクリプトとして動いてしまう）
export function takePlayScript(html: string): { html: string; json: string | null; error?: string } {
  return takeJsonScript(html, "lab-play", "動画の台本");
}

// その場で AI を呼ぶツールに添える、AIへの指示（<script type="application/json" id="lab-ai">{...}</script>）を取り出す（toolAi.ts。docs/design-tool-limits.md）
// 動画の台本と同じく、公開するツールのコードには入れない（指示は人が承認して、ツールのコードに結び付けて別に持つ）
export function takeAiScript(html: string): { html: string; json: string | null; error?: string } {
  return takeJsonScript(html, "lab-ai", "AIへの指示");
}

// id の付いた JSON の script を1つだけ取り出し、その要素を除いた HTML（ほかの部分は1文字も変えない）も返す
function takeJsonScript(html: string, id: string, label: string): { html: string; json: string | null; error?: string } {
  const tags = elementsOf(parseFragment(html, { sourceCodeLocationInfo: true })).filter((el) => el.tagName === "script" && attrOf(el, "id") === id);
  if (tags.length === 0) return { html, json: null };
  if (tags.length > 1) return { html, json: null, error: `${label}（id が ${id} の script）が2つ以上あります` };
  const tag = tags[0];
  if ((attrOf(tag, "type") ?? "").trim().toLowerCase() !== "application/json") return { html, json: null, error: `${label}の script には type="application/json" を付けてください` };
  const loc = tag.sourceCodeLocation;
  if (!loc) return { html, json: null, error: `${label}の位置を読めませんでした` };
  const json = tag.childNodes.map((n) => ("value" in n ? n.value : "")).join("");
  // 切り取るのはその要素だけ（前後の空白も残す。入れるときの前後の空白の扱いは、呼ぶ側で決める。PR #107 の ai-review の指摘）
  return { html: html.slice(0, loc.startOffset) + html.slice(loc.endOffset), json };
}
