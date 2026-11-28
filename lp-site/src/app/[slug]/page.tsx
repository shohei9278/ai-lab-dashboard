import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getLp, listPages } from "@/lib/supabase";
import { SITE_NAME } from "@/lib/site";
import { SignupForm } from "./SignupForm";
import { Tracker } from "./Tracker";
import { CtaLink } from "./CtaLink";
import { LpView } from "@/lp/LpView";
import { ShareButtons, ToolSection } from "./ToolSection";
import { FreePage } from "./FreePage";
import { FeedbackWidget } from "./FeedbackWidget";
import { imgOriginsOf } from "@/lp/pageHtml";
import { splitToolPage } from "@/lp/htmlDom";
import { ToolPageView } from "@/lp/ToolPageView";
import { ShortToolView } from "@/lp/ShortToolView";
import { toolFluid } from "@/lp/inApp";
import { RelatedPages } from "./RelatedPages";
import { PageSummary } from "./PageSummary";
import { ResultSheet } from "./ResultSheet";
import { pickOthers } from "@/lp/categories";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ r?: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { r } = await searchParams;
  const lp = await getLp(slug);
  if (!lp) return { title: SITE_NAME };
  // 結果つきでシェアされたリンク（?r=番号）は、その結果のシェア画像と題にする（番号はツールが決めた結果の一覧の中だけ）
  const no = r !== undefined && /^\d{1,2}$/.test(r) ? Number(r) : null;
  const resultName = no !== null ? lp.content.tool?.results?.[no] : undefined;
  if (resultName) {
    const rTitle = `「${resultName}」でした｜${lp.title}｜${SITE_NAME}`;
    // 作り直すと結果の名前やデザインが変わるので、版の番号を付けて、前の版の画像がキャッシュから出ないようにする
    const image = { url: `/${slug}/share/${no}?v=${lp.version}`, width: 1200, height: 630, alt: `${lp.title}の結果「${resultName}」` };
    return {
      title: rTitle,
      description: lp.content.subheadline,
      alternates: { canonical: `/${slug}` },
      openGraph: { title: rTitle, description: lp.content.subheadline, siteName: SITE_NAME, type: "website", locale: "ja_JP", images: [image] },
      twitter: { card: "summary_large_image", title: rTitle, description: lp.content.subheadline, images: [image.url] },
    };
  }
  const title = `${lp.title}｜${SITE_NAME}`;
  // シェア画像は、同じ階層の opengraph-image.tsx が自動で付ける
  // canonical: 投稿ごとの目印（?s=…）付きのURLを、同じページとして扱わせる
  // 受付を終えたページは、検索結果に出さない
  return {
    title,
    description: lp.content.subheadline,
    alternates: { canonical: `/${slug}` },
    ...(lp.status === "closed" ? { robots: { index: false, follow: true } } : {}),
    openGraph: { title, description: lp.content.subheadline, siteName: SITE_NAME, type: "website", locale: "ja_JP" },
    twitter: { card: "summary_large_image", title, description: lp.content.subheadline },
  };
}

export default async function LpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lp = await getLp(slug);
  if (!lp) notFound();

  if (lp.status === "closed") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="text-xl font-bold">{lp.title}</h1>
        <p className="mt-3 text-ink-2">{lp.content.tool ? "このツールの公開は終了しました。" : "このサービスの事前登録の受付は終了しました。"}ご関心をお寄せいただき、ありがとうございました。</p>
        <div className="mt-12 text-left"><RelatedPages slug={lp.slug} /></div>
      </main>
    );
  }

  // AIが自由に書いたページがあれば、部品の表示の代わりに画面いっぱいに出す（動くツールの案件は部品の表示のまま）
  if (lp.content.page && !lp.content.tool) {
    return (
      <main>
        <Tracker slug={lp.slug} version={lp.version} scroll={false} />
        <FreePage slug={lp.slug} version={lp.version} html={lp.content.page.html} title={lp.title} imgOrigins={imgOriginsOf(lp.content.design?.illustration?.url, lp.content.page.html)} operator={`運営: ${SITE_NAME}`} />
        <PageSummary title={lp.title} lp={lp.content} />
        <RelatedPages slug={lp.slug} />
        <FeedbackWidget slug={lp.slug} version={lp.version} kind="lp" />
      </main>
    );
  }

  // 遊び・毎日のお題のツール（short）は、開いたらすぐ画面いっぱいで遊べる形で出す（紹介ページは作らない）
  // 結果が出たら、下から シェア と ほかの遊び（同じカテゴリを先に）の欄を出す
  // 遊ぶ画面は、上の帯をなくしてツールの枠を画面に固定し、見えている範囲いっぱいに出す（運営者が決めた。inApp.ts・ShortToolView の play）。
  // 上には細い帯（サイト名・ツール名・メニューのボタン）だけを置き、シェア・ほかの遊び・ひとことはメニューから開く欄にまとめる。低い画面ではツールを縮めて収める（自分で合わせるツールは除く）
  const tool = lp.content.tool;
  if (tool && lp.content.short) {
    const others = pickOthers((await listPages().catch(() => ({ tools: [] }))).tools, lp.slug).map(({ slug, title, version }) => ({ slug, title, version }));
    return (
      <main>
        <Tracker slug={lp.slug} version={lp.version} />
        <ShortToolView
          play
          title={lp.title}
          lead={lp.content.subheadline}
          home={<Link href="/?s=related">{SITE_NAME}</Link>}
          menu={
            <ResultSheet
              slug={lp.slug}
              version={lp.version}
              shareText={tool.shareText}
              results={tool.results}
              others={others}
              menu={{
                label: "メニュー",
                // サイト全体の下の欄（運営者名・プライバシーポリシー）は遊ぶ画面の下に隠れるので、ここにも出す
                home: (
                  <>
                    <Link href="/?s=related" className="underline">{SITE_NAME} のほかのツールを見る</Link>
                    {" ・ "}
                    <Link href="/privacy" className="underline">プライバシーポリシー</Link>
                  </>
                ),
                feedback: <FeedbackWidget slug={lp.slug} version={lp.version} kind="tool" inline />,
              }}
            />
          }
          tool={<ToolSection slug={lp.slug} version={lp.version} html={tool.html} title={lp.title} data={tool.data} fonts={tool.fonts} illustration={lp.content.design?.illustration?.url} images={tool.images} ai={!!tool.ai} fill fit={!toolFluid(tool.html)} />}
        />
      </main>
    );
  }

  // 動くツールの案件で、AIが自由に書いたページがあれば、上の部分 → ツール → 下の部分 の順に出す（分けられなければ部品の表示）
  const parts = tool && lp.content.page ? splitToolPage(lp.content.page.html) : null;
  if (tool && lp.content.page && parts) {
    return (
      <main>
        {/* 上下の枠は高さを中身に合わせるので、親のページ全体がスクロールする（部品の表示と同じく、スクロールの深さを計る） */}
        <Tracker slug={lp.slug} version={lp.version} />
        <ToolPageView
          parts={parts}
          title={lp.title}
          imgOrigins={imgOriginsOf(lp.content.design?.illustration?.url, lp.content.page.html)}
          operator={`運営: ${SITE_NAME}`}
          tool={<ToolSection slug={lp.slug} version={lp.version} html={tool.html} title={lp.title} data={tool.data} fonts={tool.fonts} illustration={lp.content.design?.illustration?.url} images={tool.images} ai={!!tool.ai} />}
          after={
            <section data-section="share" className="px-6 py-12">
              <div className="mx-auto max-w-md space-y-4 text-center">
                <h2 className="text-xl font-bold">役に立ったら、シェアしてもらえるとうれしいです</h2>
                <ShareButtons slug={lp.slug} version={lp.version} text={tool.shareText} results={tool.results} />
              </div>
            </section>
          }
        />
        <PageSummary title={lp.title} lp={lp.content} />
        <RelatedPages slug={lp.slug} />
        <FeedbackWidget slug={lp.slug} version={lp.version} kind="tool" />
      </main>
    );
  }

  return (
    <main>
      <Tracker slug={lp.slug} version={lp.version} />
      <LpView
        lp={lp.content}
        title={lp.title}
        topCta={<CtaLink slug={lp.slug} version={lp.version} href={lp.content.tool ? "#tool" : "#signup"}>{lp.content.cta}</CtaLink>}
        signup={
          lp.content.tool
            ? <ShareButtons slug={lp.slug} version={lp.version} text={lp.content.tool.shareText} results={lp.content.tool.results} />
            : <SignupForm slug={lp.slug} version={lp.version} cta={lp.content.cta} />
        }
        tool={lp.content.tool ? <ToolSection slug={lp.slug} version={lp.version} html={lp.content.tool.html} title={lp.title} data={lp.content.tool.data} fonts={lp.content.tool.fonts} illustration={lp.content.design?.illustration?.url} images={lp.content.tool.images} ai={!!lp.content.tool.ai} /> : undefined}
      />
      <RelatedPages slug={lp.slug} />
      <FeedbackWidget slug={lp.slug} version={lp.version} kind={lp.content.tool ? "tool" : "lp"} />
    </main>
  );
}
