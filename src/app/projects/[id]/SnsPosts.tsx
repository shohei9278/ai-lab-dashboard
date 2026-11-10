"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "@/components/LoopAction";
import { jstDateTime } from "@/lib/format";

// 投稿先（growth.ts の SNS_PLATFORMS と同じ）
const PLATFORMS: Record<string, string> = {
  x: "X", threads: "Threads", bluesky: "Bluesky", instagram: "Instagram", note: "note", facebook: "Facebook", line: "LINE", community: "コミュニティ・掲示板", other: "その他",
};

export type PostView = {
  id: number; code: string; platform: string; angle: string | null; text: string; author: "ai" | "human"; status: "draft" | "posted";
  postedAt: string | null; postUrl: string | null; impressions: number | null; visits: number; conversions: number; link: string | null;
};

// X の文字数の数え方（日本語は2、URLは23）。サーバー側の xWeightedLength と同じ
function weighted(text: string): number {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2;
  }
  return n + 24;
}

async function call(body: Record<string, unknown>) {
  const res = await fetch("/api/sns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) throw new Error(data.error ?? "通信に失敗しました");
  return data;
}

// SNSで広める: AIの下書き → あなたが直して X に投稿 → 投稿ごとの訪問・成果
export function SnsPosts({ projectId, posts, convNoun, ready, imageUrl, account }: { projectId: number; posts: PostView[]; convNoun: string; ready: boolean; imageUrl: string | null; account: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [own, setOwn] = useState("");
  const [ownPlatform, setOwnPlatform] = useState("x");

  async function act(label: string, body: Record<string, unknown>) {
    setBusy(label);
    setError(null);
    try {
      await call(body);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const drafts = posts.filter((p) => p.status === "draft");
  const posted = posts.filter((p) => p.status === "posted");
  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="font-bold">SNSで広める</h2>
        <p className="text-xs text-muted">
          AIが投稿の下書きを作ります。直してから「Xで投稿する」を押すと、あなたのXの投稿画面が開くので、確認して投稿してください（AIが勝手に投稿することはありません）。
          投稿ごとに専用のリンクが付くので、どの投稿から何人来て、何人が{convNoun}したかが分かります。
        </p>
        {account && (
          <p className="mt-1 text-sm">
            投稿は <a href={`https://x.com/${account}`} target="_blank" rel="noreferrer" className="font-bold text-accent underline">@{account}</a> で行ってください。
            <span className="text-xs text-muted">（「Xで投稿する」は、ブラウザでログイン中のアカウントで開きます。違うときは、Xでアカウントを切り替えてから押してください）</span>
          </p>
        )}
        {!ready && <p className="mt-1 text-xs" style={{ color: "var(--warning)" }}>▲ 設定で「LPサイトのURL」を入れると、リンク付きで投稿できます。</p>}
      </div>

      {imageUrl && (
        <figure className="space-y-1">
          {/* 公開サイトが作る画像をそのまま表示する（XなどにURLを貼ると、この画像が付く） */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="シェアしたときに出る画像" width={600} height={315} className="w-full max-w-md rounded-lg border border-line" />
          <figcaption className="text-xs text-muted">投稿するとリンクにこの画像が付きます（LPのテーマ色と見出しから自動で作成。LPを直すと画像も変わります）</figcaption>
        </figure>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-ink-2">
          切り口の希望（任意）
          <input value={hint} onChange={(e) => setHint(e.target.value)} maxLength={300} placeholder="例: 夏休みの終わりに合わせて" className="mt-1 block w-72 max-w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
        </label>
        <ActionButton variant="primary" disabled={!!busy} onClick={() => act("AIが下書きを作っています…", { action: "draft", projectId, count: 3, hint })}>
          AIに下書きを3つ作らせる（約5円）
        </ActionButton>
      </div>

      {drafts.length > 0 && (
        <ul className="space-y-3">
          {drafts.map((p) => <Draft key={p.id} p={p} busy={!!busy} act={act} />)}
        </ul>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-accent">自分で書く（X 以外の投稿先も選べます）</summary>
        <p className="mt-1 text-xs text-muted">投稿先ごとに専用のリンクが付くので、どの場所から何人来たかも測れます。</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select value={ownPlatform} onChange={(e) => setOwnPlatform(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-sm" aria-label="投稿先">
            {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <textarea value={own} onChange={(e) => setOwn(e.target.value)} rows={2} maxLength={1000} className="block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" aria-label="自分で書く投稿" />
          <ActionButton disabled={!!busy || !own.trim()} onClick={async () => { if (await act("保存しています…", { action: "add", projectId, text: own, platform: ownPlatform })) setOwn(""); }}>下書きに追加</ActionButton>
        </div>
      </details>

      {busy && <p className="text-sm text-ink-2" role="status">{busy}</p>}
      {error && <p className="text-sm" style={{ color: "var(--critical)" }} role="alert">{error}</p>}

      {posted.length > 0 && (
        <div className="space-y-2 border-t border-line pt-3">
          <h3 className="text-sm font-bold">投稿したもの</h3>
          <div className="overflow-x-auto">
            <table className="m-cards w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-2 py-1.5">投稿</th>
                  <th className="px-2 py-1.5 text-right">表示回数</th>
                  <th className="px-2 py-1.5 text-right">訪問</th>
                  <th className="px-2 py-1.5 text-right">{convNoun}</th>
                  <th className="px-2 py-1.5">投稿のURL</th>
                </tr>
              </thead>
              <tbody>
                {posted.map((p) => <PostedRow key={p.id} p={p} act={act} convNoun={convNoun} />)}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            訪問と{convNoun}は5分ごとに自動で入ります（そのリンクから来た人を、ブラウザ単位で数えます）。表示回数は、Xのアナリティクスで見た数を入れると、クリック率の目安が出ます（任意）。
          </p>
        </div>
      )}
    </section>
  );
}

function Draft({ p, busy, act }: { p: PostView; busy: boolean; act: (label: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const [text, setText] = useState(p.text);
  const isX = p.platform === "x";
  const len = weighted(text);
  const over = isX && len > 280;
  const full = `${text}\n${p.link ?? ""}`;
  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span className="rounded bg-surface-2 px-1.5 py-0.5">{p.author === "ai" ? "AIの下書き" : "あなたの下書き"}</span>
        <span className="rounded border border-line px-1.5 py-0.5">{PLATFORMS[p.platform] ?? p.platform}</span>
        {p.angle && <span>切り口: {p.angle}</span>}
        {isX && <span className="num ml-auto" style={{ color: over ? "var(--critical)" : undefined }}>{len} / 280{over ? "（長すぎます）" : ""}</span>}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== p.text && text.trim() && act("保存しています…", { action: "update", id: p.id, text })}
        rows={3}
        className="block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
        aria-label="投稿の本文"
      />
      {p.link && <div className="truncate text-xs text-muted">付くリンク: {p.link}</div>}
      <div className="flex flex-wrap gap-2">
        {!isX && (
          <button type="button" disabled={busy || !p.link} onClick={() => act("投稿済みにしています…", { action: "posted", id: p.id, text })} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50">
            投稿した
          </button>
        )}
        {isX && <a
          href={p.link ? `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(p.link)}` : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!p.link || over || busy}
          onClick={(e) => {
            if (!p.link || over || busy) return e.preventDefault();
            void act("投稿済みにしています…", { action: "posted", id: p.id, text });
          }}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${p.link && !over ? "bg-accent text-accent-ink" : "cursor-not-allowed bg-surface-2 text-muted"}`}
        >
          Xで投稿する ↗
        </a>}
        <button type="button" disabled={!p.link} onClick={() => navigator.clipboard.writeText(full).catch(() => {})} className="rounded-lg border border-line px-3 py-1.5 text-sm">
          {isX ? "コピー（ほかのSNS用）" : "文とリンクをコピー"}
        </button>
        <button type="button" disabled={busy} onClick={() => act("消しています…", { action: "delete", id: p.id })} className="px-2 text-sm text-ink-2 underline">消す</button>
      </div>
    </li>
  );
}

function PostedRow({ p, act, convNoun }: { p: PostView; act: (label: string, body: Record<string, unknown>) => Promise<boolean>; convNoun: string }) {
  const [impr, setImpr] = useState(p.impressions === null ? "" : String(p.impressions));
  const [url, setUrl] = useState(p.postUrl ?? "");
  const ctr = p.impressions ? p.visits / p.impressions : null;
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="m-wide max-w-md px-2 py-2">
        <div className="text-xs text-muted">{PLATFORMS[p.platform] ?? p.platform}・{p.postedAt ? jstDateTime(p.postedAt) : ""}{p.angle ? `・${p.angle}` : ""}</div>
        <div className="line-clamp-3">{p.text}</div>
      </td>
      <td data-label="表示回数" className="px-2 py-2 text-right">
        <input
          type="number" min={0} value={impr} onChange={(e) => setImpr(e.target.value)}
          onBlur={() => impr !== (p.impressions === null ? "" : String(p.impressions)) && act("保存しています…", { action: "stats", id: p.id, impressions: impr })}
          className="num w-20 rounded border border-line bg-surface px-1 py-0.5 text-right" aria-label="表示回数" placeholder="—"
        />
        {ctr !== null && <div className="num text-xs text-muted">クリック率 {(ctr * 100).toFixed(1)}%</div>}
      </td>
      <td data-label="訪問" className="num px-2 py-2 text-right">{p.visits}</td>
      <td data-label={convNoun} className="num px-2 py-2 text-right">{p.conversions}</td>
      <td data-label="投稿のURL" className="m-wide px-2 py-2">
        <input
          value={url} onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url !== (p.postUrl ?? "") && act("保存しています…", { action: "stats", id: p.id, postUrl: url })}
          placeholder={p.platform === "x" ? "https://x.com/…" : "https://…"} className="w-44 rounded border border-line bg-surface px-1 py-0.5 text-xs" aria-label="投稿のURL"
        />
        {p.postUrl && <a href={p.postUrl} target="_blank" rel="noreferrer" className="ml-1 text-xs text-accent underline">開く</a>}
      </td>
    </tr>
  );
}
