import type { CSSProperties, ReactNode } from "react";
import { SECTIONS, THEMES, type IconName, type Lp, type SectionKey } from "./content";

// LPの見た目。公開用LPサイトとダッシュボードのプレビューで同じものを使う
// 色はテーマから CSS 変数で渡し、ライト・ダークの両方に対応する（light-dark）
// 見出しの形・書体・背景の模様・角・各部分の見せ方と並び順は、AIが DESIGN_OPTIONS から選ぶ
// topCta / signup に、それぞれの環境のボタンや登録フォームを差し込む
// 動くツールの案件では、tool にツール本体（ToolFrame）を、signup にシェアのボタンを差し込む
export function LpView({ lp, title, topCta, signup, tool }: { lp: Lp; title: string; topCta: ReactNode; signup: ReactNode; tool?: ReactNode }) {
  const d = lp.design;
  const theme = THEMES[d?.theme ?? "trust"];
  const isTool = !!lp.tool && !!tool;
  const layout = d?.layout ?? "center";
  const ill = d?.illustration;
  const vars = {
    "--lp-accent": `light-dark(${theme.accent[0]}, ${theme.accent[1]})`,
    "--lp-soft": `light-dark(${theme.soft[0]}, ${theme.soft[1]})`,
    "--lp-on-accent": d?.theme === "bold" ? "light-dark(#ffffff, #121211)" : "#ffffff",
    "--lp-r": d?.corners === "square" ? "6px" : "18px",
    fontFamily: d?.font === "rounded" ? "var(--font-rounded), var(--font-noto), sans-serif" : d?.font === "mincho" ? "var(--font-mincho), serif" : undefined,
  } as CSSProperties;

  // 見出しの横（または下）に置くもの: イラストがあればイラスト、なければ画面イメージ
  const side = ill ? <Illustration ill={ill} /> : !isTool && lp.preview ? <Preview p={lp.preview} /> : null;
  // イラストを見出しに使ったときは、画面イメージを別の部分として後ろに出す
  const previewSection = ill && !isTool && lp.preview;
  const band = layout === "band";
  const twoCol = (layout === "split" || layout === "left" || band) && !!side;

  const heroText = (
    <div className={`space-y-5 ${layout === "center" ? "text-center" : ""}`}>
      <div className="text-sm opacity-70">{title}</div>
      {d?.badge && (
        <span
          className="inline-block rounded-full px-3 py-1 text-xs font-bold"
          style={band ? { background: "var(--lp-on-accent)", color: "var(--lp-accent)" } : { background: "var(--lp-accent)", color: "var(--lp-on-accent)" }}
        >
          {d.badge}
        </span>
      )}
      <h1 className={`font-bold leading-tight ${layout === "left" ? "text-4xl sm:text-6xl sm:leading-[1.15]" : "text-3xl sm:text-5xl sm:leading-tight"}`}>{lp.headline}</h1>
      <p className="text-lg opacity-85">{lp.subheadline}</p>
      <div>{topCta}</div>
      <p className="text-xs opacity-70">{isTool ? "無料・登録不要で、このページですぐに使えます。" : "現在準備中のサービスです。事前登録は無料です。"}</p>
    </div>
  );

  const sections: Record<SectionKey, ReactNode> = {
    pains: lp.pains.length > 0 && (
      <section key="pains" data-section="pains" className="px-6 py-16">
        <div className="mx-auto max-w-3xl space-y-6">
          <h2 className="text-center text-2xl font-bold">こんなことで困っていませんか？</h2>
          <Pains items={lp.pains} style={d?.painStyle ?? "cards"} />
        </div>
      </section>
    ),
    beforeAfter: lp.beforeAfter && (
      <section key="beforeAfter" className="px-6 pb-16 pt-4">
        <div className="mx-auto grid max-w-4xl items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-[var(--lp-r)] border border-[color:var(--border)] p-5">
            <div className="mb-2 text-sm font-bold opacity-60">いま</div>
            <ul className="space-y-1.5 text-sm">{lp.beforeAfter.before.map((x) => <li key={x}>・{x}</li>)}</ul>
          </div>
          <div aria-hidden className="self-center text-center text-2xl font-bold" style={{ color: "var(--lp-accent)" }}>→</div>
          <div className="rounded-[var(--lp-r)] p-5" style={{ background: "var(--lp-soft)", outline: "2px solid var(--lp-accent)" }}>
            <div className="mb-2 text-sm font-bold" style={{ color: "var(--lp-accent)" }}>使い始めたら（目指す姿）</div>
            <ul className="space-y-1.5 text-sm">{lp.beforeAfter.after.map((x) => <li key={x}>・{x}</li>)}</ul>
          </div>
        </div>
      </section>
    ),
    features: (
      <section key="features" data-section="features" className="px-6 py-16" style={{ background: "var(--lp-soft)" }}>
        <div className="mx-auto max-w-5xl space-y-8">
          <h2 className="text-center text-2xl font-bold">できること</h2>
          <Features items={lp.features} style={d?.featureStyle ?? "cards"} />
        </div>
      </section>
    ),
    steps: lp.steps && (
      <section key="steps" className="px-6 py-16">
        <div className="mx-auto max-w-4xl space-y-8">
          <h2 className="text-center text-2xl font-bold">使い方</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {lp.steps.map((st, i) => (
              <li key={st.title} className="space-y-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold" style={{ background: "var(--lp-accent)", color: "var(--lp-on-accent)" }}>{i + 1}</span>
                <h3 className="font-bold">{st.title}</h3>
                <p className="text-sm opacity-80">{st.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    ),
    faq: lp.faq.length > 0 && (
      <section key="faq" data-section="faq" className="border-t border-[color:var(--border)] px-6 py-16">
        <div className="mx-auto max-w-2xl space-y-4">
          <h2 className="text-center text-2xl font-bold">よくある質問</h2>
          {lp.faq.map((f) => (
            <div key={f.q} className="rounded-[var(--lp-r)] border border-[color:var(--border)] p-4">
              <div className="font-bold">Q. {f.q}</div>
              <div className="mt-1 text-sm opacity-80">A. {f.a}</div>
            </div>
          ))}
        </div>
      </section>
    ),
  };

  return (
    <div style={vars} className="text-[color:var(--text)]">
      <header
        className="relative overflow-hidden"
        style={band
          ? { background: "var(--lp-accent)", color: "var(--lp-on-accent)" }
          : { background: "linear-gradient(180deg, var(--lp-soft), transparent)" }}
      >
        {d?.pattern && d.pattern !== "none" && <div aria-hidden className="pointer-events-none absolute inset-0" style={patternStyle(d.pattern, band)} />}
        <div className={`relative mx-auto px-6 py-16 sm:py-24 ${twoCol ? "grid max-w-5xl items-center gap-10 lg:grid-cols-2" : layout === "left" ? "max-w-4xl" : "max-w-3xl"}`}>
          {heroText}
          {side && <div className={twoCol ? "" : "mx-auto mt-12 max-w-xl text-left"}>{side}</div>}
        </div>
      </header>

      {isTool && (
        <section id="tool" data-section="tool" className="px-4 pb-16 pt-8">
          <div className="mx-auto max-w-3xl overflow-hidden rounded-[var(--lp-r)] border border-[color:var(--border)] bg-[color:var(--bg)] shadow-xl">{tool}</div>
        </section>
      )}

      {previewSection && (
        <section className="px-6 pb-4 pt-12">
          <div className="mx-auto max-w-xl"><Preview p={lp.preview!} /></div>
        </section>
      )}

      {(d?.order ?? SECTIONS).map((k) => sections[k])}

      {isTool ? (
        <section data-section="share" className="px-6 py-16" style={{ background: "var(--lp-soft)" }}>
          <div className="mx-auto max-w-md space-y-4 text-center">
            <h2 className="text-xl font-bold">役に立ったら、シェアしてもらえるとうれしいです</h2>
            {signup}
          </div>
        </section>
      ) : (
        <section id="signup" data-section="signup" className="px-6 py-16" style={{ background: "var(--lp-soft)" }}>
          <div className="mx-auto max-w-md space-y-4 text-center">
            <h2 className="text-xl font-bold">{lp.cta}</h2>
            <p className="text-sm opacity-80">現在準備中のサービスです。メールアドレスを登録いただくと、提供を始めるときにご案内します。登録は無料です。</p>
            {signup}
          </div>
        </section>
      )}
    </div>
  );
}

// 見出しの背景の模様（テーマの色を薄く使う）
function patternStyle(p: "dots" | "grid" | "diagonal", onAccent: boolean): CSSProperties {
  const c = onAccent ? "color-mix(in srgb, var(--lp-on-accent) 18%, transparent)" : "color-mix(in srgb, var(--lp-accent) 16%, transparent)";
  if (p === "dots") return { backgroundImage: `radial-gradient(${c} 1.5px, transparent 1.6px)`, backgroundSize: "20px 20px" };
  if (p === "grid") return { backgroundImage: `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`, backgroundSize: "28px 28px" };
  return { backgroundImage: `repeating-linear-gradient(45deg, ${c} 0 2px, transparent 2px 14px)` };
}

function Pains({ items, style }: { items: string[]; style: "cards" | "bubbles" | "checklist" }) {
  if (style === "bubbles") {
    return (
      <ul className="space-y-4">
        {items.map((x, i) => (
          <li key={x} className={`flex ${i % 2 ? "justify-end" : ""}`}>
            <span className="relative max-w-[85%] rounded-[var(--lp-r)] px-5 py-3" style={{ background: "var(--lp-soft)" }}>
              「{x}」
              <span aria-hidden className={`absolute -bottom-1.5 h-3 w-3 rotate-45 ${i % 2 ? "right-6" : "left-6"}`} style={{ background: "var(--lp-soft)" }} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (style === "checklist") {
    return (
      <ul className="mx-auto max-w-xl space-y-3">
        {items.map((x) => (
          <li key={x} className="flex gap-3 border-b border-[color:var(--border)] pb-3">
            <span aria-hidden className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs font-bold" style={{ borderColor: "var(--lp-accent)", color: "var(--lp-accent)" }}>✓</span>
            <span>{x}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((x) => (
        <li key={x} className="flex gap-3 rounded-[var(--lp-r)] p-4" style={{ background: "var(--lp-soft)" }}>
          <span aria-hidden className="mt-0.5 shrink-0 font-bold" style={{ color: "var(--lp-accent)" }}>!</span>
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}

function Features({ items, style }: { items: Lp["features"]; style: "cards" | "list" | "numbered" }) {
  if (style === "list") {
    return (
      <ul className="mx-auto max-w-2xl divide-y divide-[color:var(--border)] rounded-[var(--lp-r)] bg-[color:var(--bg)] px-5">
        {items.map((f) => (
          <li key={f.title} className="flex gap-4 py-5">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--lp-r)]" style={{ background: "var(--lp-accent)", color: "var(--lp-on-accent)" }}><Icon name={f.icon ?? "check"} /></span>
            <div>
              <h3 className="font-bold">{f.title}</h3>
              <p className="text-sm opacity-80">{f.body}</p>
            </div>
          </li>
        ))}
      </ul>
    );
  }
  if (style === "numbered") {
    return (
      <ol className="grid gap-6 sm:grid-cols-3">
        {items.map((f, i) => (
          <li key={f.title} className="space-y-2">
            <div className="text-5xl font-bold leading-none" style={{ color: "var(--lp-accent)" }}>{String(i + 1).padStart(2, "0")}</div>
            <h3 className="font-bold">{f.title}</h3>
            <p className="text-sm opacity-80">{f.body}</p>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {items.map((f) => (
        <div key={f.title} className="space-y-2 rounded-[var(--lp-r)] bg-[color:var(--bg)] p-5">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--lp-r)]" style={{ background: "var(--lp-accent)", color: "var(--lp-on-accent)" }}><Icon name={f.icon ?? "check"} /></span>
          <h3 className="font-bold">{f.title}</h3>
          <p className="text-sm opacity-80">{f.body}</p>
        </div>
      ))}
    </div>
  );
}

// AIが描いたイラスト（公開用の保存場所に置いた画像）
function Illustration({ ill }: { ill: { url: string; alt: string } }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={ill.url} alt={ill.alt} width={1536} height={1024} className="h-auto w-full rounded-[var(--lp-r)] shadow-xl" />
  );
}

// LP内のボタンの見た目（テーマの色を使う）
export const lpButtonClass = "inline-block rounded-full px-7 py-3.5 font-bold shadow-sm transition hover:opacity-90 disabled:opacity-60";
export const lpButtonStyle: CSSProperties = { background: "var(--lp-accent)", color: "var(--lp-on-accent)" };

// 開発予定の画面のイメージ。実在する画面と誤解されないよう、イメージであることを必ず書く
function Preview({ p }: { p: NonNullable<Lp["preview"]> }) {
  return (
    <figure className="overflow-hidden rounded-[var(--lp-r)] border border-[color:var(--border)] bg-[color:var(--bg)] shadow-xl">
      <div className="flex items-center gap-1.5 border-b border-[color:var(--border)] px-4 py-2.5">
        {[0, 1, 2].map((i) => <span key={i} aria-hidden className="h-2.5 w-2.5 rounded-full bg-[color:var(--border)]" />)}
        <span className="ml-2 truncate text-xs font-medium opacity-70">{p.title}</span>
      </div>
      <div className="p-4 text-sm">
        {p.kind === "table" && (
          <table className="w-full text-left text-xs">
            {p.columns && p.columns.length > 0 && (
              <thead><tr>{p.columns.map((c) => <th key={c} className="border-b border-[color:var(--border)] px-2 py-1.5 font-bold">{c}</th>)}</tr></thead>
            )}
            <tbody>
              {p.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-[color:var(--border)] px-2 py-1.5">{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        )}
        {p.kind === "list" && (
          <ul className="space-y-2">
            {p.rows.map((r, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: "var(--lp-soft)" }}>
                <span aria-hidden className="h-4 w-4 shrink-0 rounded-full border-2" style={{ borderColor: "var(--lp-accent)" }} />
                <span className="flex-1">{r[0]}</span>
                {r[1] && <span className="text-xs font-medium" style={{ color: "var(--lp-accent)" }}>{r[1]}</span>}
              </li>
            ))}
          </ul>
        )}
        {p.kind === "chat" && (
          <div className="space-y-2">
            {p.rows.map((r, i) => (
              <div key={i} className={`flex ${i % 2 ? "justify-end" : ""}`}>
                <div className="max-w-[80%] rounded-2xl px-3 py-2" style={i % 2 ? { background: "var(--lp-accent)", color: "var(--lp-on-accent)" } : { background: "var(--lp-soft)" }}>
                  {r.length > 1 && <div className="text-[10px] opacity-70">{r[0]}</div>}
                  <div>{r.length > 1 ? r[1] : r[0]}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {p.kind === "form" && (
          <div className="space-y-3">
            {p.rows.map((r, i) => (
              <div key={i}>
                <div className="text-xs font-medium opacity-70">{r[0]}</div>
                <div className="mt-1 rounded-lg border border-[color:var(--border)] px-3 py-2">{r[1] ?? ""}</div>
              </div>
            ))}
            <div className="rounded-lg py-2 text-center text-xs font-bold" style={{ background: "var(--lp-accent)", color: "var(--lp-on-accent)" }}>送信</div>
          </div>
        )}
      </div>
      <figcaption className="border-t border-[color:var(--border)] px-4 py-2 text-[11px] opacity-60">画面はイメージです（開発中）</figcaption>
    </figure>
  );
}

// 線の太さをそろえた簡単なアイコン（外部の画像やフォントは使わない）
const PATHS: Record<IconName, string> = {
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  calendar: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
  check: "M5 12l4 4 10-10",
  users: "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  phone: "M8 3h8v18H8zM11 18h2",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM21 21l-5-5",
  pen: "M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4",
  folder: "M3 6h6l2 2h10v11H3z",
  yen: "M6 4l6 8 6-8M12 12v8M7 13h10M7 17h10",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
