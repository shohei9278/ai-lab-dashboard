// SNS のアプリの中のブラウザ（X・Instagram・Facebook・LINE・Threads・TikTok）で開いたかを見分ける（#72 で運営者が見つけた）
// 運営者が確かめ用ページ（/inapp-check）を X・LINE・Instagram で開いて測った結果、遊ぶ画面は次の作りにした（運営者が決めた）
// - 遊ぶ画面は画面に固定する（position: fixed。ShortToolView の play）。固定したものの下の端は、どのアプリでも見えている範囲の下の端に合う
// - X は上の帯の分（約64px）だけページを下にずらして表示し、その量は JavaScript の値にも env(safe-area-inset-*) にも出ない。
//   固定すると上がその帯の下に隠れるので、X のときだけ上を空ける（--lab-inapp-top。globals.css）。上には小さな表示しかないので、目測でも壊れにくい
// - LINE・Instagram は、帯がページの外にあるので空けない
// 見分け方
// - X の iPhone のアプリは名乗り（UA）に「Twitter for iPhone」を付ける。念のため、X の短縮リンク（t.co）から来たスマホも X とみなす
// - 名乗りにアプリの印がなくても、iPhone で「Safari/」がない（WKWebView）・Android で「; wv)」がある（WebView）ものは、アプリの中（other）とみなす
// - 一度見分けたら、同じタブの中でサイトの別のページへ移っても続ける（移った先では、t.co からの来訪が分からなくなるため）
export type InApp = "x" | "instagram" | "line" | "other";
export function inAppOf(ua: string, referrer: string, coarse: boolean): InApp | null {
  if (/\bTwitter(Android)?\b/i.test(ua)) return "x";
  if (/\bInstagram\b/i.test(ua)) return "instagram";
  if (/\bLine\//i.test(ua)) return "line";
  if (/\b(FBAN|FBAV|FB_IAB|Barcelona|Threads|musical_ly|BytedanceWebview|TikTok)\b/i.test(ua)) return "other";
  if (coarse) {
    try {
      if (/(^|\.)t\.co$/.test(new URL(referrer).hostname)) return "x";
    } catch {
      // 来た元が URL でない
    }
  }
  if (/\b(iPhone|iPod|iPad)\b/.test(ua) && !/\bSafari\//.test(ua)) return "other";
  if (/\bAndroid\b/.test(ua) && /; wv\)/.test(ua)) return "other";
  return null;
}
export const IN_APP_KINDS: readonly InApp[] = ["x", "instagram", "line", "other"];
// 同じタブで前に見分けて覚えた値（決まった種類のときだけ使う）
export const rememberedInApp = (v: string | null): InApp | null => (v && (IN_APP_KINDS as readonly string[]).includes(v) ? (v as InApp) : null);
// 訪問の記録（/api/track の inapp）に入れる値: アプリの種類・アプリの外なら ""・分からない（古いページから届いた・決まっていない値）なら null（提案箱 #108）
export const trackedInApp = (v: unknown): InApp | "" | null => (v === "" ? "" : typeof v === "string" ? rememberedInApp(v) : null);

// 描く前に <html data-inapp="アプリ"> を付ける、ページの先頭で動かす文（inAppOf をそのまま使う）
// 保存領域（sessionStorage）の読み書きは個別にエラーから守る（プライベートモードなどで使えなくても、名乗りでの見分けと印付けは続ける。PR #113 の ai-review の指摘）
export const IN_APP_SCRIPT = `try{var k="lab-inapp",was=null;try{was=sessionStorage.getItem(k)}catch(e){}if(${JSON.stringify(IN_APP_KINDS)}.indexOf(was)<0)was=null;var on=was||(${inAppOf.toString()})(navigator.userAgent,document.referrer,!!(window.matchMedia&&matchMedia("(pointer:coarse)").matches));if(on){document.documentElement.setAttribute("data-inapp",on);document.documentElement.setAttribute("data-inapp-src","script");try{sessionStorage.setItem(k,on)}catch(e){}}}catch(e){}`;
// 読み込んだあとの付け直しは、InAppMark（app/InAppMark.tsx）がする

// 遊ぶ画面のツールを縮めて収める（運営者が決めた）。見えている高さが PLAY_MIN_HEIGHT より低いときは、ツールをその高さで作らせて、
// 枠ごと transform: scale で縮める（幅も同じ割合で広げて作らせるので、横は枠いっぱいのまま）。高ければ縮めずにそのまま出す
// 自分で高さに合わせられるツールは <meta name="lab-fluid"> を付け、縮めずに実際の大きさで出す（toolFluid）
export const PLAY_MIN_HEIGHT = 640;
export function fitScale(width: number, height: number, minHeight = PLAY_MIN_HEIGHT): { scale: number; width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { scale: 1, width, height };
  const scale = Math.min(1, height / minHeight);
  return { scale, width: width / scale, height: height / scale };
}
// 属性の順番・= のまわりの空白・引用符の有無が違っても見分ける（PR #118 の ai-review の指摘）
export const toolFluid = (html: string) => /<meta\b[^>]*\sname\s*=\s*(["']?)lab-fluid\1(?=[\s/>])/i.test(html);
