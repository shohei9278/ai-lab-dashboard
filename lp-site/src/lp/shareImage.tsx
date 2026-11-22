import { THEMES, type Lp } from "./content";

// SNSにURLを貼ったときに出る画像（1200×630）。LPのテーマ色と見出しから作る（AIは呼ばない）
// 公開サイトの一覧のカードにも同じ画像を使う。動くツールは、イラストの代わりに本物の画面（何も押す前の1画面）をスマホの枠に入れて右に置く
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

// result: 結果つきでシェアされたときの結果の名前。あれば見出しの代わりに大きく出す
export function ShareImage({ lp, title, siteName, result }: { lp: Lp; title: string; siteName: string; result?: string }) {
  const theme = THEMES[lp.design?.theme ?? "trust"];
  const accent = theme.accent[0];
  const soft = theme.soft[0];
  const t = shareImageText(lp, title, siteName);
  const shot = lp.tool ? lp.shot : undefined;
  const ill = shot ? undefined : lp.design?.illustration;
  // 見出しが長いときは文字を小さくする（イラストや画面があるときは幅が狭くなるので、さらに小さく）
  const narrow = !!(ill || shot);
  const size = narrow ? (t.headline.length > 26 ? 42 : t.headline.length > 16 ? 50 : 58) : t.headline.length > 34 ? 52 : t.headline.length > 22 ? 62 : 72;
  // 画面は、スマホの枠に幅を合わせて上から見せる（縦に長いページ全体の写真でも、上の部分が出る）
  const screenW = 276;
  const screenH = shot ? Math.round((screenW * shot.height) / shot.width) : 0;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: `linear-gradient(135deg, ${soft} 0%, #ffffff 70%)`, fontFamily: "NotoSansJP", color: "#111111", padding: shot ? "64px 400px 64px 72px" : "64px 72px", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", fontSize: shot ? 24 : 30, fontWeight: 700, color: accent }}>{t.title}</div>
        {t.badge ? (
          <div style={{ display: "flex", flexShrink: 0, whiteSpace: "nowrap", fontSize: shot ? 20 : 24, fontWeight: 700, color: "#ffffff", background: accent, borderRadius: 999, padding: "6px 18px" }}>{t.badge}</div>
        ) : null}
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 40 }}>
        {result ? (
          <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: "#444444" }}>結果は</div>
            <div style={{ display: "flex", fontSize: Math.round((result.length > 16 ? 56 : result.length > 10 ? 68 : 84) * (shot ? 0.75 : 1)), fontWeight: 700, lineHeight: 1.2, color: accent }}>「{result}」</div>
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, fontSize: size, fontWeight: 700, lineHeight: 1.3, letterSpacing: "-0.01em" }}>{t.headline}</div>
        )}
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
      {shot ? (
        // 下の端からはみ出すように置き、スマホを手前に出したように見せる
        <div style={{ position: "absolute", right: 72, top: 56, width: screenW + 24, height: 660, display: "flex", padding: 12, background: "#111111", borderRadius: 48 }}>
          <div style={{ display: "flex", width: screenW, height: 636, borderRadius: 36, overflow: "hidden", background: "#ffffff" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot.url} alt="" width={screenW} height={screenH} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
