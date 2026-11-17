import { ImageResponse } from "next/og";
import { getLp } from "@/lib/supabase";
import { SITE_NAME } from "@/lib/site";
import { SHARE_SIZE, ShareImage, loadJapaneseFont, shareImageText } from "@/lp/shareImage";

// 結果つきでシェアされたリンク（/スラッグ?r=番号）に出す画像。結果の名前は、ツールが決めた一覧の中のものだけを使う
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; n: string }> }) {
  const { slug, n } = await params;
  if (!/^\d{1,2}$/.test(n)) return new Response("Not found", { status: 404 });
  const lp = await getLp(slug);
  const result = lp?.content.tool?.results?.[Number(n)];
  if (!lp || !result) return new Response("Not found", { status: 404 });
  const t = shareImageText(lp.content, lp.title, SITE_NAME);
  const text = Object.values(t).join("") + result + "結果は「」";
  const [regular, bold] = await Promise.all([loadJapaneseFont(text, 400), loadJapaneseFont(text, 700)]);
  const fonts = [
    ...(regular ? [{ name: "NotoSansJP", data: regular, weight: 400 as const, style: "normal" as const }] : []),
    ...(bold ? [{ name: "NotoSansJP", data: bold, weight: 700 as const, style: "normal" as const }] : []),
  ];
  return new ImageResponse(<ShareImage lp={lp.content} title={lp.title} siteName={SITE_NAME} result={result} />, {
    ...SHARE_SIZE,
    fonts,
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
