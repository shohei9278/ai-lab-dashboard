import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLp } from "@/lib/supabase";
import { SITE_NAME } from "@/lib/site";
import { SignupForm } from "./SignupForm";
import { Tracker } from "./Tracker";
import { CtaLink } from "./CtaLink";
import { LpView } from "@/lp/LpView";
import { ShareButtons, ToolSection } from "./ToolSection";
import { FreePage } from "./FreePage";
import { FeedbackWidget } from "./FeedbackWidget";
import { imgOriginsOf } from "@/lp/pageHtml";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const lp = await getLp(slug);
  if (!lp) return { title: SITE_NAME };
  const title = `${lp.title}｜${SITE_NAME}`;
  // シェア画像は、同じ階層の opengraph-image.tsx が自動で付ける
  return {
    title,
    description: lp.content.subheadline,
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
        <p className="mt-3 text-ink-2">このサービスの事前登録の受付は終了しました。ご関心をお寄せいただき、ありがとうございました。</p>
      </main>
    );
  }

  // AIが自由に書いたページがあれば、部品の表示の代わりに画面いっぱいに出す（動くツールの案件は部品の表示のまま）
  if (lp.content.page && !lp.content.tool) {
    return (
      <main>
        <Tracker slug={lp.slug} version={lp.version} />
        <FreePage slug={lp.slug} version={lp.version} html={lp.content.page.html} title={lp.title} imgOrigins={imgOriginsOf(lp.content.design?.illustration?.url, lp.content.page.html)} operator={`運営: ${SITE_NAME}`} />
        <FeedbackWidget slug={lp.slug} version={lp.version} kind="lp" />
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
            ? <ShareButtons slug={lp.slug} version={lp.version} text={lp.content.tool.shareText} />
            : <SignupForm slug={lp.slug} version={lp.version} cta={lp.content.cta} />
        }
        tool={lp.content.tool ? <ToolSection slug={lp.slug} version={lp.version} html={lp.content.tool.html} title={lp.title} /> : undefined}
      />
      <FeedbackWidget slug={lp.slug} version={lp.version} kind={lp.content.tool ? "tool" : "lp"} />
    </main>
  );
}
