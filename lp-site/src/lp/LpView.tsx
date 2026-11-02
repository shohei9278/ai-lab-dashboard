import type { CSSProperties, ReactNode } from "react";
import { THEMES, type IconName, type Lp } from "./content";

// LPの見た目。公開用LPサイトとダッシュボードのプレビューで同じものを使う
// 色はテーマから CSS 変数で渡し、ライト・ダークの両方に対応する（light-dark）
// topCta / signup に、それぞれの環境のボタンや登録フォームを差し込む
// 動くツールの案件では、tool にツール本体（ToolFrame）を、signup にシェアのボタンを差し込む
export function LpView({ lp, title, topCta, signup, tool }: { lp: Lp; title: string; topCta: ReactNode; signup: ReactNode; tool?: ReactNode }) {
  const isTool = !!lp.tool && !!tool;
  const theme = THEMES[lp.design?.theme ?? "trust"];
  const vars = {
    "--lp-accent": `light-dark(${theme.accent[0]}, ${theme.accent[1]})`,
    "--lp-soft": `light-dark(${theme.soft[0]}, ${theme.soft[1]})`,
    "--lp-on-accent": lp.design?.theme === "bold" ? "light-dark(#ffffff, #121211)" : "#ffffff",
  } as CSSProperties;
  const split = !isTool && lp.design?.layout === "split" && !!lp.preview;

  return (
    <div style={vars} className="text-[color:var(--text)]">
      <header className="relative overflow-hidden" style={{ background: "linear-gradient(180deg, var(--lp-soft), transparent)" }}>
        <div className={`mx-auto px-6 py-16 sm:py-24 ${split ? "grid max-w-5xl items-center gap-10 lg:grid-cols-2" : "max-w-3xl text-center"}`}>
          <div className="space-y-5">
            <div className="text-sm opacity-70">{title}</div>
            {lp.design?.badge && (
              <span className="inline-block rounded-full px-3 py-1 text-xs font-medium" style={{ background: "var(--lp-accent)", color: "var(--lp-on-accent)" }}>
                {lp.design.badge}
              </span>
            )}
            <h1 className="text-3xl font-bold leading-tight sm:text-5xl sm:leading-tight">{lp.headline}</h1>
            <p className="text-lg opacity-80">{lp.subheadline}</p>
            <div>{topCta}</div>
            <p className="text-xs opacity-60">{isTool ? "無料・登録不要で、このページですぐに使えます。" : "現在準備中のサービスです。事前登録は無料です。"}</p>
          </div>
          {!isTool && lp.preview && <div className={split ? "" : "mx-auto mt-12 max-w-xl text-left"}><Preview p={lp.preview} /></div>}
        </div>
      </header>

      {isTool && (
        <section id="tool" data-section="tool" className="px-4 pb-16">
          <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg)] shadow-xl">{tool}</div>
        </section>
      )}

      {lp.pains.length > 0 && (
        <section data-section="pains" className="px-6 py-16">
          <div className="mx-auto max-w-3xl space-y-6">
            <h2 className="text-center text-2xl font-bold">こんなことで困っていませんか？</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {lp.pains.map((x) => (
                <li key={x} className="flex gap-3 rounded-2xl p-4" style={{ background: "var(--lp-soft)" }}>
                  <span aria-hidden className="mt-0.5 shrink-0 font-bold" style={{ color: "var(--lp-accent)" }}>!</span>
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {lp.beforeAfter && (
        <section className="px-6 pb-16">
          <div className="mx-auto grid max-w-4xl items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <div className="rounded-2xl border border-[color:var(--border)] p-5">
              <div className="mb-2 text-sm font-bold opacity-60">いま</div>
              <ul className="space-y-1.5 text-sm">{lp.beforeAfter.before.map((x) => <li key={x}>・{x}</li>)}</ul>
            </div>
            <div aria-hidden className="self-center text-center text-2xl font-bold" style={{ color: "var(--lp-accent)" }}>→</div>
            <div className="rounded-2xl p-5" style={{ background: "var(--lp-soft)", outline: "2px solid var(--lp-accent)" }}>
              <div className="mb-2 text-sm font-bold" style={{ color: "var(--lp-accent)" }}>使い始めたら（目指す姿）</div>
              <ul className="space-y-1.5 text-sm">{lp.beforeAfter.after.map((x) => <li key={x}>・{x}</li>)}</ul>
            </div>
          </div>
        </section>
      )}

      <section data-section="features" className="px-6 py-16" style={{ background: "var(--lp-soft)" }}>
        <div className="mx-auto max-w-5xl space-y-8">
          <h2 className="text-center text-2xl font-bold">できること</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {lp.features.map((f) => (
              <div key={f.title} className="space-y-2 rounded-2xl bg-[color:var(--bg)] p-5">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--lp-accent)", color: "var(--lp-on-accent)" }}>
                  <Icon name={f.icon ?? "check"} />
                </span>
                <h3 className="font-bold">{f.title}</h3>
                <p className="text-sm opacity-80">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {lp.steps && (
        <section className="px-6 py-16">
          <div className="mx-auto max-w-4xl space-y-8">
            <h2 className="text-center text-2xl font-bold">使い方</h2>
            <ol className="grid gap-4 sm:grid-cols-3">
              {lp.steps.map((s, i) => (
                <li key={s.title} className="space-y-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold" style={{ background: "var(--lp-accent)", color: "var(--lp-on-accent)" }}>{i + 1}</span>
                  <h3 className="font-bold">{s.title}</h3>
                  <p className="text-sm opacity-80">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {lp.faq.length > 0 && (
        <section data-section="faq" className="border-t border-[color:var(--border)] px-6 py-16">
          <div className="mx-auto max-w-2xl space-y-4">
            <h2 className="text-center text-2xl font-bold">よくある質問</h2>
            {lp.faq.map((f) => (
              <div key={f.q} className="rounded-2xl border border-[color:var(--border)] p-4">
                <div className="font-bold">Q. {f.q}</div>
                <div className="mt-1 text-sm opacity-80">A. {f.a}</div>
              </div>
            ))}
          </div>
        </section>
      )}

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

// LP内のボタンの見た目（テーマの色を使う）
export const lpButtonClass = "inline-block rounded-full px-7 py-3.5 font-bold shadow-sm transition hover:opacity-90 disabled:opacity-60";
export const lpButtonStyle: CSSProperties = { background: "var(--lp-accent)", color: "var(--lp-on-accent)" };

// 開発予定の画面のイメージ。実在する画面と誤解されないよう、イメージであることを必ず書く
function Preview({ p }: { p: NonNullable<Lp["preview"]> }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg)] shadow-xl">
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
