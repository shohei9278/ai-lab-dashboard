import { LpView, lpButtonClass, lpButtonStyle } from "../../../../lp-site/src/lp/LpView";
import { ToolFrame } from "../../../../lp-site/src/lp/ToolFrame";
import { PageFrame } from "../../../../lp-site/src/lp/PageFrame";
import { imgOriginsOf } from "../../../../lp-site/src/lp/pageHtml";
import type { Lp } from "../../../../lp-site/src/lp/content";

// LP・ツールの本体を、公開サイトと同じ部品で表示する（プレビューと見比べで共通）
export function PreviewBody({ lp, title, pc = false, freePage = true }: { lp: Lp; title: string; pc?: boolean; freePage?: boolean }) {
  const button = <button type="button" aria-disabled title="プレビューでは押せません" className={`${lpButtonClass} cursor-default`} style={lpButtonStyle}>{lp.cta}</button>;
  if (lp.page && freePage) {
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
        tool={lp.tool ? <ToolFrame html={lp.tool.html} title={title} /> : undefined}
      />
    </article>
  );
}
