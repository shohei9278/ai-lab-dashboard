import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLp } from "@/lib/supabase";
import { SITE_NAME } from "@/lib/site";
import { SignupForm } from "./SignupForm";
import { Tracker } from "./Tracker";
import { CtaLink } from "./CtaLink";
import { LpView } from "@/lp/LpView";
import { ShareButtons, ToolSection } from "./ToolSection";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const lp = await getLp(slug);
  if (!lp) return { title: SITE_NAME };
  return { title: `${lp.title}｜${SITE_NAME}`, description: lp.content.subheadline };
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
    </main>
  );
}
