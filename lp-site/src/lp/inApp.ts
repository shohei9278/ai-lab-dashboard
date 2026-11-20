// SNS のアプリの中のブラウザ（X・Instagram・Facebook・LINE・Threads・TikTok）で開いたかを見分ける（#72 で運営者が見つけた）
// これらのアプリは、ページの下に自分の帯（閉じる・URL など）を重ねるが、その高さはページからは分からない
// （env(safe-area-inset-bottom) にも入らない）。そこで、見分けたら <html data-inapp> を付け、
// 全画面のツールの枠の下に目安の余白（--lab-inapp-pad）を空けて、いちばん下のボタンが帯に隠れないようにする
// - X の iPhone のアプリは、ブラウザの名乗り（UA）に印を付けないので、X の短縮リンク（t.co）から来たスマホも同じ扱いにする
// - 一度見分けたら、同じタブの中でサイトの別のページへ移っても続ける（移った先では、t.co からの来訪が分からなくなるため）
export function inAppOf(ua: string, referrer: string, coarse: boolean): boolean {
  if (/\b(Twitter|TwitterAndroid|FBAN|FBAV|FB_IAB|Instagram|Line\/|Barcelona|Threads|musical_ly|BytedanceWebview|TikTok)\b/i.test(ua)) return true;
  if (!coarse) return false;
  try { return /(^|\.)t\.co$/.test(new URL(referrer).hostname); } catch { return false; }
}

// 描く前に <html> に印を付ける、ページの先頭で動かす文（inAppOf をそのまま使う）
export const IN_APP_SCRIPT = `try{var k="lab-inapp",on=sessionStorage.getItem(k)==="1"||(${inAppOf.toString()})(navigator.userAgent,document.referrer,matchMedia("(pointer:coarse)").matches);if(on){sessionStorage.setItem(k,"1");document.documentElement.setAttribute("data-inapp","")}}catch(e){}`;
