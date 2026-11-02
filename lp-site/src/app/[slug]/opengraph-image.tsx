import { ImageResponse } from "next/og";
import { getLp } from "@/lib/supabase";
import { SITE_NAME } from "@/lib/site";
import { SHARE_SIZE, ShareImage, loadJapaneseFont, shareImageText } from "@/lp/shareImage";

export const size = SHARE_SIZE;
export const contentType = "image/png";
export const alt = "サービスの紹介";

// SNSにURLを貼ったときに出る画像
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lp = await getLp(slug);
  if (!lp) return new Response("Not found", { status: 404 });
  const t = shareImageText(lp.content, lp.title, SITE_NAME);
  const text = Object.values(t).join("");
  const [regular, bold] = await Promise.all([loadJapaneseFont(text, 400), loadJapaneseFont(text, 700)]);
  const fonts = [
    ...(regular ? [{ name: "NotoSansJP", data: regular, weight: 400 as const, style: "normal" as const }] : []),
    ...(bold ? [{ name: "NotoSansJP", data: bold, weight: 700 as const, style: "normal" as const }] : []),
  ];
  return new ImageResponse(<ShareImage lp={lp.content} title={lp.title} siteName={SITE_NAME} />, { ...SHARE_SIZE, fonts });
}
