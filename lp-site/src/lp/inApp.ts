// SNS のアプリの中のブラウザ（X・Instagram・Facebook・LINE・Threads・TikTok）で開いたかを見分ける（#72 で運営者が見つけた）
// これらのアプリは、ページの下に自分の帯（閉じる・URL など）を重ねるが、その高さはページからは分からない
// （env(safe-area-inset-bottom) にも入らない）。そこで、見分けたら <html data-inapp> を付け、
// 全画面のツールの枠の下に目安の余白（--lab-inapp-pad）を空けて、いちばん下のボタンが帯に隠れないようにする
// - X の iPhone のアプリは、ブラウザの名乗り（UA）にアプリの印を付けない。そこで、アプリの中のブラウザの作りそのもので見分ける（運営者が X で確かめて、
//   見分けられていなかった）。iPhone の Safari・Chrome・Firefox などは名乗りの最後に「Safari/…」が付くが、アプリの中のブラウザ（WKWebView）には付かない。
//   Android のアプリの中のブラウザ（WebView）は、名乗りに「; wv)」が付く
// - 念のため、X の短縮リンク（t.co）から来たスマホも同じ扱いにする
// - 一度見分けたら、同じタブの中でサイトの別のページへ移っても続ける（移った先では、t.co からの来訪が分からなくなるため）
export function inAppOf(ua: string, referrer: string, coarse: boolean): boolean {
  if (/\b(Twitter|TwitterAndroid|FBAN|FBAV|FB_IAB|Instagram|Line\/|Barcelona|Threads|musical_ly|BytedanceWebview|TikTok)\b/i.test(ua)) return true;
  if (/\b(iPhone|iPod|iPad)\b/.test(ua) && !/\bSafari\//.test(ua)) return true;
  if (/\bAndroid\b/.test(ua) && /; wv\)/.test(ua)) return true;
  if (!coarse) return false;
  try { return /(^|\.)t\.co$/.test(new URL(referrer).hostname); } catch { return false; }
}

// 描く前に <html> に印を付ける、ページの先頭で動かす文（inAppOf をそのまま使う）
// 保存領域（sessionStorage）の読み書きは個別にエラーから守る（プライベートモードなどで使えなくても、名乗りでの見分けと印付けは続ける。PR #113 の ai-review の指摘）
export const IN_APP_SCRIPT = `try{var k="lab-inapp",was=false;try{was=sessionStorage.getItem(k)==="1"}catch(e){}var on=was||(${inAppOf.toString()})(navigator.userAgent,document.referrer,!!(window.matchMedia&&matchMedia("(pointer:coarse)").matches));if(on){document.documentElement.setAttribute("data-inapp","");try{sessionStorage.setItem(k,"1")}catch(e){}}}catch(e){}`;
