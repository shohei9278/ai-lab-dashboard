// AIが書いたHTMLのタグを、ブラウザに近い読み方で順に取り出す（ツールを入れる場所・結果の一覧を確かめるため）
// コメントは飛ばし、script・style などの中身はタグとして読まない。属性は引用符あり・なし・値なしのどれも読む
export type HtmlTag = {
  name: string; // 小文字
  close: boolean; // </name>
  selfClose: boolean; // <name ... />
  attrs: [string, string][]; // 書かれた順（名前は小文字。同じ名前が2回あってもそのまま並べる）
  start: number; // "<" の位置
  end: number; // ">" の次の位置
  inner?: string; // 中身をタグとして読まない要素（script など）の、開きタグについた中身
};

// 中身を文字として扱う要素（中に "<div>" と書いてあってもタグではない）。template の中身もページの要素にはならないので飛ばす
const RAW = new Set(["script", "style", "textarea", "title", "template"]);

export function htmlTags(html: string): HtmlTag[] {
  const out: HtmlTag[] = [];
  const lower = html.toLowerCase();
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      const e = html.indexOf("-->", lt + 4);
      i = e < 0 ? html.length : e + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const e = html.indexOf(">", lt);
      i = e < 0 ? html.length : e + 1;
      continue;
    }
    const head = /^<(\/?)([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 200));
    if (!head) {
      i = lt + 1;
      continue;
    }
    const tag: HtmlTag = { name: head[2].toLowerCase(), close: head[1] === "/", selfClose: false, attrs: [], start: lt, end: html.length };
    let j = lt + head[0].length;
    // 属性を読む
    while (j < html.length) {
      while (j < html.length && /\s/.test(html[j])) j++;
      if (j >= html.length) break;
      if (html[j] === ">") {
        j++;
        break;
      }
      if (html[j] === "/") {
        j++;
        while (j < html.length && /\s/.test(html[j])) j++;
        if (html[j] === ">") {
          tag.selfClose = true;
          j++;
          break;
        }
        continue;
      }
      const nm = /^[^\s"'>/=]+|^[^\s>/]/.exec(html.slice(j, j + 200))![0];
      j += nm.length;
      let k = j;
      while (k < html.length && /\s/.test(html[k])) k++;
      let value = "";
      if (html[k] === "=") {
        k++;
        while (k < html.length && /\s/.test(html[k])) k++;
        const q = html[k];
        if (q === '"' || q === "'") {
          const e = html.indexOf(q, k + 1);
          value = html.slice(k + 1, e < 0 ? html.length : e);
          j = e < 0 ? html.length : e + 1;
        } else {
          const m = /^[^\s>]*/.exec(html.slice(k))![0];
          value = m;
          j = k + m.length;
        }
      }
      tag.attrs.push([nm.toLowerCase(), value]);
    }
    tag.end = j;
    out.push(tag);
    i = j;
    if (!tag.close && RAW.has(tag.name)) {
      const e = lower.indexOf(`</${tag.name}`, i);
      tag.inner = html.slice(i, e < 0 ? html.length : e);
      i = e < 0 ? html.length : e;
    }
  }
  return out;
}

// 最初に書かれた属性の値（ブラウザは同じ名前の属性が2つあると最初のものを使う）
export const attrOf = (t: HtmlTag, name: string) => t.attrs.find(([n]) => n === name)?.[1];
// その名前の属性がいくつ書かれているか
export const attrCount = (t: HtmlTag, name: string) => t.attrs.filter(([n]) => n === name).length;
