// AIが丸ごと自由に書いたLPを、隔離された枠に入れるページの形にする。公開サイト・プレビュー・公開前のスクリーンショット確認で同じものを使う
// - CSP で外部への通信を止める（読み込めるのは Google Fonts と、こちらで作ったイラストの画像だけ）
// - 登録フォームの送信・プライバシーポリシーを開く・GAのイベントは、こちらで差し込む小さなスクリプトが親のページに頼む
//   （枠の中からは通信できないので、AIの書いたコードに頼らない）

// AIに守らせる、ページの決まりごと（作成の指示文と、公開前の機械チェックで同じものを使う）
export const PAGE_RULES = {
  form: 'form id="signup" の中に、input type="email"（メールアドレス）・input type="checkbox" name="consent"（プライバシーポリシーへの同意）・送信ボタンを置く',
  privacy: '同意の文の「プライバシーポリシー」は <a href="/privacy" data-lab="privacy"> にする',
  operator: 'ページの一番下に、運営者名を入れる空の <span data-lab="operator"></span> と、プライバシーポリシーへのリンク（同じく data-lab="privacy"）を置く',
};

function csp(imgOrigins: string[]): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com data:",
    `img-src data: blob: ${imgOrigins.join(" ")}`.trim(),
    "media-src data: blob:",
    "form-action 'none'",
  ].join("; ");
}

// 枠の中で動く橋渡し。親からは {__lab:"init"|"signup-result"}、親へは {__lab:"signup"|"event"|"open"} を送る
const BRIDGE = `<script>(function(){
function post(m){m.__lab=m.__lab||"event";parent.postMessage(m,"*")}
function ev(name,params){post({__lab:"event",name:name,params:params||{}})}
var started=false,depth=0,form=document.getElementById("signup");
document.addEventListener("click",function(e){
  var a=e.target.closest&&e.target.closest("a");if(!a)return;
  var href=a.getAttribute("href")||"";
  if(a.dataset.lab==="privacy"||href==="/privacy"){e.preventDefault();post({__lab:"open",path:"/privacy"});return}
  if(href.charAt(0)==="#"){e.preventDefault();var t=href.length>1&&document.getElementById(href.slice(1));if(t)t.scrollIntoView({behavior:"smooth",block:"start"});if(href==="#signup")ev("cta_click",{position:a.dataset.position||"page"});return}
  e.preventDefault();
},true);
document.addEventListener("focusin",function(e){if(!started&&e.target.type==="email"){started=true;ev("form_start")}});
addEventListener("scroll",function(){var h=document.documentElement;var p=Math.floor((h.scrollTop+innerHeight)/h.scrollHeight*4)*25;if(p>depth){depth=p;if(p>=50)ev("scroll_depth",{percent:p})}},{passive:true});
function msg(text,cls){if(!form)return;var p=form.querySelector(".lab-error");if(!p){p=document.createElement("p");p.setAttribute("role","alert");form.appendChild(p)}p.className=cls;p.textContent=text}
if(form)form.addEventListener("submit",function(e){
  e.preventDefault();
  var email=form.querySelector('input[type="email"]'),consent=form.querySelector('input[name="consent"]'),btn=form.querySelector('[type="submit"],button:not([type])');
  if(consent&&!consent.checked){msg("プライバシーポリシーへの同意が必要です","lab-error");return}
  if(btn)btn.disabled=true;
  post({__lab:"signup",email:email?email.value:"",consent:!!(consent&&consent.checked)});
});
addEventListener("message",function(e){
  if(e.source!==parent||!e.data||typeof e.data!=="object")return;var d=e.data;
  if(d.__lab==="init"){document.querySelectorAll('[data-lab="operator"]').forEach(function(el){el.textContent=d.operator||""})}
  if(d.__lab==="signup-result"&&form){
    if(d.ok){var p=document.createElement("p");p.className="lab-done";p.setAttribute("role","status");p.textContent=d.message||"登録を受け付けました。提供を始めるときに、メールでご案内します。";form.replaceWith(p);form=null}
    else{var b=form.querySelector('[type="submit"],button:not([type])');if(b)b.disabled=false;msg(d.message||"送信できませんでした。時間をおいてもう一度お試しください。","lab-error")}
  }
});
post({__lab:"ready"});
})();</script>`;

export function wrapPageHtml(html: string, opts: { imgOrigins?: string[] } = {}): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp(opts.imgOrigins ?? [])}">`;
  let out = html.replace(/^\s*<!doctype[^>]*>/i, "");
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => m + meta) : meta + out;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, BRIDGE + "</body>") : out + BRIDGE;
  return "<!doctype html>" + out;
}

// イラストの画像を置いている場所（Supabase の公開用の保存領域）だけ、画像の読み込みを許す
// イラストを描き直した・外したあとも、ページに書かれた前のイラストが表示されるよう、ページの中のURLも見る
export function imgOriginsOf(illustrationUrl: string | undefined, html: string): string[] {
  const urls = [illustrationUrl ?? "", ...(html.match(/https:\/\/[a-z0-9-]+\.supabase\.co\//gi) ?? [])];
  const origins = new Set<string>();
  for (const u of urls) {
    try {
      if (u) origins.add(new URL(u).origin);
    } catch {}
  }
  return [...origins];
}
