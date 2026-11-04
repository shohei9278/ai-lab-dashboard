import { THEMES, type Lp } from "./content";

// SNSにURLを貼ったときに出る画像（1200×630）。LPのテーマ色と見出しから作る（AIは呼ばない）
export const SHARE_SIZE = { width: 1200, height: 630 };

// 画像に使う文字だけを Google Fonts から取り出す（日本語のフォントは大きいので、使う文字だけにする）
export async function loadJapaneseFont(text: string, weight: 400 | 700): Promise<ArrayBuffer | null> {
  try {
    const chars = [...new Set(text)].join("");
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}&text=${encodeURIComponent(chars)}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export function shareImageText(lp: Lp, title: string, siteName: string) {
  const label = lp.tool ? "無料・登録不要ですぐ使えます" : "事前登録受付中";
  return { title, headline: lp.headline, badge: lp.design?.badge ?? "", label, siteName };
}

export function ShareImage({ lp, title, siteName }: { lp: Lp; title: string; siteName: string }) {
  const theme = THEMES[lp.design?.theme ?? "trust"];
  const accent = theme.accent[0];
  const soft = theme.soft[0];
  const t = shareImageText(lp, title, siteName);
  const ill = lp.design?.illustration;
  // 見出しが長いときは文字を小さくする（イラストがあるときは幅が半分になるので、さらに小さく）
  const size = ill ? (t.headline.length > 26 ? 42 : t.headline.length > 16 ? 50 : 58) : t.headline.length > 34 ? 52 : t.headline.length > 22 ? 62 : 72;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: `linear-gradient(135deg, ${soft} 0%, #ffffff 70%)`, fontFamily: "NotoSansJP", color: "#111111", padding: "64px 72px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: accent }}>{t.title}</div>
        {t.badge ? (
          <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: "#ffffff", background: accent, borderRadius: 999, padding: "6px 18px" }}>{t.badge}</div>
        ) : null}
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 40 }}>
        <div style={{ display: "flex", flex: 1, fontSize: size, fontWeight: 700, lineHeight: 1.3, letterSpacing: "-0.01em" }}>{t.headline}</div>
        {ill ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ill.url} alt="" width={450} height={300} style={{ borderRadius: 24, objectFit: "cover" }} />
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "#ffffff", background: accent, borderRadius: 14, padding: "12px 26px" }}>{t.label}</div>
        <div style={{ display: "flex", fontSize: 26, color: "#555555" }}>{t.siteName}</div>
      </div>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 14, background: accent, display: "flex" }} />
    </div>
  );
}
