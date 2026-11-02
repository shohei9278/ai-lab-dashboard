import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLp } from "@/lib/supabase";
import { SITE_NAME } from "@/lib/site";
import { SignupForm } from "./SignupForm";
import { Tracker } from "./Tracker";
import { CtaLink } from "./CtaLink";

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

  const c = lp.content;
  return (
    <main>
      <Tracker slug={lp.slug} version={lp.version} />
      <header className="mx-auto max-w-3xl space-y-5 px-6 py-16 text-center sm:py-24">
        <div className="text-sm text-muted">{lp.title}</div>
        <h1 className="text-2xl font-bold leading-snug sm:text-4xl">{c.headline}</h1>
        <p className="text-ink-2 sm:text-lg">{c.subheadline}</p>
        <CtaLink slug={lp.slug} version={lp.version}>{c.cta}</CtaLink>
      </header>

      <section data-section="pains" className="bg-surface-2 px-6 py-14">
        <div className="mx-auto max-w-xl space-y-3">
          <h2 className="text-center font-bold">こんなことで困っていませんか？</h2>
          <ul className="space-y-2">
            {c.pains.map((x) => (
              <li key={x} className="flex gap-2"><span aria-hidden className="text-muted">□</span>{x}</li>
            ))}
          </ul>
        </div>
      </section>

      <section data-section="features" className="mx-auto grid max-w-4xl gap-6 px-6 py-14 sm:grid-cols-3">
        {c.features.map((f) => (
          <div key={f.title} className="space-y-1">
            <h3 className="font-bold">{f.title}</h3>
            <p className="text-sm text-ink-2">{f.body}</p>
          </div>
        ))}
      </section>

      <section data-section="faq" className="mx-auto max-w-2xl space-y-3 border-t border-line px-6 py-14">
        <h2 className="font-bold">よくある質問</h2>
        {c.faq.map((f) => (
          <div key={f.q}>
            <div className="font-medium">Q. {f.q}</div>
            <div className="text-sm text-ink-2">A. {f.a}</div>
          </div>
        ))}
      </section>

      <section id="signup" data-section="signup" className="bg-surface-2 px-6 py-16">
        <div className="mx-auto max-w-md space-y-4 text-center">
          <h2 className="text-lg font-bold">{c.cta}</h2>
          <p className="text-sm text-ink-2">現在準備中のサービスです。メールアドレスを登録いただくと、提供を始めるときにご案内します。登録は無料です。</p>
          <SignupForm slug={lp.slug} version={lp.version} cta={c.cta} />
        </div>
      </section>
    </main>
  );
}
