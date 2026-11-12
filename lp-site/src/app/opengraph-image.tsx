import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";
import { SHARE_SIZE, loadJapaneseFont } from "@/lp/shareImage";

export const size = SHARE_SIZE;
export const contentType = "image/png";
export const alt = `${SITE_NAME}｜登録なしで使える小さなWebツール`;

// トップページをSNSに貼ったときに出る画像
export default async function Image() {
  const lead = "登録なしで使える、小さなWebツール";
  const font = await loadJapaneseFont(SITE_NAME + lead, 700);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 96, background: "#f6f5f2", color: "#1a1a1a", fontFamily: "NotoSansJP" }}>
        <div style={{ fontSize: 96, fontWeight: 700 }}>{SITE_NAME}</div>
        <div style={{ marginTop: 24, fontSize: 48, fontWeight: 700, color: "#c4511a" }}>{lead}</div>
      </div>
    ),
    { ...SHARE_SIZE, fonts: font ? [{ name: "NotoSansJP", data: font, weight: 700, style: "normal" }] : [] },
  );
}
