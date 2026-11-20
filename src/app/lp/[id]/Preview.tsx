import { LpView, lpButtonClass, lpButtonStyle } from "../../../../lp-site/src/lp/LpView";
import { ToolFrame } from "../../../../lp-site/src/lp/ToolFrame";
import { PageFrame } from "../../../../lp-site/src/lp/PageFrame";
import { imgOriginsOf } from "../../../../lp-site/src/lp/pageHtml";
import { splitToolPage } from "../../../../lp-site/src/lp/htmlDom";
import { ToolPageView } from "../../../../lp-site/src/lp/ToolPageView";
import { SHORT_SHARE_HEADING, ShortToolView } from "../../../../lp-site/src/lp/ShortToolView";
import type { Lp } from "../../../../lp-site/src/lp/content";

// LP・ツールの本体を、公開サイトと同じ部品で表示する（プレビューと見比べで共通）
export function PreviewBody({ lp, title, pc = false, freePage = true }: { lp: Lp; title: string; pc?: boolean; freePage?: boolean }) {
  const button = <button type="button" aria-disabled title="プレビューでは押せません" className={`${lpButtonClass} cursor-default`} style={lpButtonStyle}>{lp.cta}</button>;
  // 遊び・毎日のお題のツール（short）は、公開サイトと同じく 上の細い帯 → 画面いっぱいのツール → 一行とシェア の形で出す
  // 公開サイトでは枠の高さを画面に合わせるが、プレビューは画面の中の箱なので、よくある画面の高さ（帯の分を引いたもの）に決める
  // 結果が出たあとに下から出す欄（シェア・ほかの遊び）は、公開したページでだけ出る
  if (lp.tool && lp.short) {
    return (
      <div className={`mx-auto overflow-hidden rounded-2xl border border-line bg-[color:var(--bg)] ${pc ? "max-w-[1280px]" : "max-w-[390px]"}`}>
        <ShortToolView
          title={title}
          lead={lp.subheadline}
          home={<span title="プレビューでは押せません">（公開サイトの屋号）</span>}
          frameHeight={pc ? "676px" : "800px"}
          tool={<ToolFrame html={lp.tool.html} title={title} data={lp.tool.data} fonts={lp.tool.fonts} illustration={lp.design?.illustration?.url} images={lp.tool.images} fill />}
          after={
            // シェアの欄も、公開サイトと同じ見た目で出す（プレビューでは押せない。押せる形にすると、未公開のページを広めてしまうため）
            <section data-section="share" className="px-6 pb-12 pt-2">
              <div className="mx-auto max-w-md space-y-4 text-center">
                <h2 className="text-lg font-bold">{SHORT_SHARE_HEADING}</h2>
                <div className="flex flex-wrap justify-center gap-3">
                  <button type="button" aria-disabled title="プレビューでは押せません" className={`${lpButtonClass} cursor-default`} style={lpButtonStyle}>X でシェア</button>
                  <button type="button" aria-disabled title="プレビューでは押せません" className="cursor-default rounded-full border border-[color:var(--border)] px-6 py-3 font-bold">リンクをコピー</button>
                </div>
                <p className="text-xs text-ink-2">シェアのボタンは、公開したページで動きます</p>
              </div>
            </section>
          }
        />
      </div>
    );
  }
  // 動くツールの案件で、自由に書いたページを上下に分けられるときは、公開サイトと同じく 上 → ツール → 下 で出す
  const parts = lp.page && freePage && lp.tool ? splitToolPage(lp.page.html) : null;
  if (lp.page && lp.tool && parts) {
    return (
      <div className={`mx-auto overflow-hidden rounded-2xl border border-line ${pc ? "max-w-[1280px]" : "max-w-[390px]"}`}>
        <ToolPageView
          parts={parts}
          title={title}
          imgOrigins={imgOriginsOf(lp.design?.illustration?.url, lp.page.html)}
          operator="運営: （公開サイトの屋号が入ります）"
          tool={<ToolFrame html={lp.tool.html} title={title} data={lp.tool.data} fonts={lp.tool.fonts} illustration={lp.design?.illustration?.url} images={lp.tool.images} />}
        />
      </div>
    );
  }
  if (lp.page && freePage && !lp.tool) {
    return (
      <div className={`mx-auto overflow-hidden rounded-2xl border border-line ${pc ? "max-w-[1280px]" : "max-w-[390px]"}`}>
        <PageFrame html={lp.page.html} title={title} height={pc ? 800 : 780} imgOrigins={imgOriginsOf(lp.design?.illustration?.url, lp.page.html)} operator="運営: （公開サイトの屋号が入ります）" />
      </div>
    );
  }
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-[color:var(--bg)]">
      <LpView
        lp={lp}
        title={title}
        topCta={lp.tool ? <a href="#tool" className={lpButtonClass} style={lpButtonStyle}>{lp.cta}</a> : button}
        signup={<div className="text-center">{button}</div>}
        tool={lp.tool ? <ToolFrame html={lp.tool.html} title={title} data={lp.tool.data} fonts={lp.tool.fonts} illustration={lp.design?.illustration?.url} images={lp.tool.images} /> : undefined}
      />
    </article>
  );
}
