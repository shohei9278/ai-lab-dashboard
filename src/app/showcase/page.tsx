import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db, getSettings, type ProjectRow } from "@/lib/db";
import { CONV, KIND_LABEL, STAGE_LABEL, ideaAuthorStats, projectTotals } from "@/lib/loop";
import { modelInfo } from "@/lib/models";
import { costEfficiency } from "@/lib/cost";
import { publicUrl } from "@/lib/publish";
import { NOTE_CERTAINTY, NOTE_TOPICS, type NoteRow } from "@/lib/notes";
import { listReports, type Report } from "@/lib/report";
import { pct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "AIが自動でプロダクトを作る実験",
  description: "AIがアイデアを考え、ページやツールを作り、反応を見て続けるか撤退するかを判断する実験の記録です。",
};

// 実験の様子を外に見せる、見るだけのページ（パスワードなしで開ける）
// 載せるのは、実案件のうち公開したもの・終わったものだけ。まだ公開していないアイデアや、承認待ちの中身は出さない
export default function Showcase() {
  const s = getSettings();
  if (!s.showcaseEnabled) notFound();

  const projects = (db().prepare("SELECT * FROM projects WHERE demo = 0 AND (public_version IS NOT NULL OR stage IN ('continued','killed')) ORDER BY id DESC").all() as ProjectRow[]);
  const all = db().prepare("SELECT COUNT(*) AS n FROM projects WHERE demo = 0").get() as { n: number };
  const ideas = db().prepare("SELECT COUNT(*) AS n FROM idea_candidates").get() as { n: number };
  const cost = costEfficiency().all;
  const aiTotal = (db().prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_calls").get() as { s: number }).s * s.usdJpy;
  const notes = db().prepare("SELECT * FROM notes WHERE is_public = 1 ORDER BY at DESC").all() as NoteRow[];
  const latest = listReports()[0];
  const report = latest ? (JSON.parse(latest.content) as Report) : null;
  const authors = ideaAuthorStats().filter((a) => a.candidates > 0);
  const yen = (x: number) => `${Math.round(x).toLocaleString("ja-JP")}円`;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">AIが自動でプロダクトを作る実験</h1>
        <p className="text-ink-2">
          3社のAI（Claude・GPT・Gemini）が毎日アイデアを出し合い、互いに採点し、紹介ページや小さなツールを作って公開します。
          集まった反応を見て、AIが「続ける・改善・撤退」を提案し、人は要所の承認だけをします。このページは、その記録を自動で表示しています。
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="AIが出したアイデア" value={`${ideas.n}件`} />
        <Tile label="進めた案件" value={`${all.n}件`} />
        <Tile label="公開した案件" value={`${projects.filter((p) => p.public_version !== null).length}件`} />
        <Tile label="訪問（累計）" value={`${cost.visits}人`} />
        <Tile label="登録・利用（累計）" value={`${cost.conversions}件`} />
        <Tile label="AI費用（累計）" value={yen(aiTotal)} sub={cost.perConversion === null ? undefined : `成果1件あたり ${yen(cost.perConversion)}`} />
      </section>

      {report && (
        <section className="card space-y-2 p-4">
          <h2 className="font-bold">今週のまとめ（AIが作成）</h2>
          <p className="whitespace-pre-wrap text-sm">{report.summary}</p>
          <p className="text-xs text-muted">{latest!.period_start}〜{latest!.period_end}</p>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-bold">公開した案件</h2>
        {projects.length === 0 ? <p className="text-sm text-ink-2">まだありません。</p> : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">案件</th>
                  <th className="px-3 py-2">形</th>
                  <th className="px-3 py-2">いまの段階</th>
                  <th className="px-3 py-2">アイデアを出したAI</th>
                  <th className="px-3 py-2 text-right">訪問</th>
                  <th className="px-3 py-2 text-right">成果の率</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const t = projectTotals(p.id);
                  const url = s.showcaseShowLinks ? publicUrl(p.id) : null;
                  const m = modelInfo(p.idea_model ?? p.model_id);
                  return (
                    <tr key={p.id} className="num border-b border-line last:border-0">
                      <td className="px-3 py-2">{url ? <a href={url} target="_blank" rel="noreferrer" className="text-accent underline">{p.title}</a> : p.title}</td>
                      <td className="px-3 py-2 text-xs">{KIND_LABEL[p.kind]}</td>
                      <td className="px-3 py-2 text-xs">{STAGE_LABEL[p.stage]}</td>
                      <td className="px-3 py-2 text-xs"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: `var(--series-${m.provider})` }} />{m.label}</td>
                      <td className="px-3 py-2 text-right">{t.visits}</td>
                      <td className="px-3 py-2 text-right">{t.visits ? `${CONV[p.kind].rate} ${pct(t.rate, 1)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {authors.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">AIどうしの採点</h2>
          <p className="text-sm text-ink-2">アイデアは作者を伏せて3社全員で採点します。「自分の案への点」が「他社からの点」より高いと、自分の案をひいきしている可能性があります。</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">AI</th>
                  <th className="px-3 py-2 text-right">出した案 / 選ばれた</th>
                  <th className="px-3 py-2 text-right">他社からの点</th>
                  <th className="px-3 py-2 text-right">自分の案への点</th>
                </tr>
              </thead>
              <tbody>
                {authors.map((a) => {
                  const m = modelInfo(a.author);
                  return (
                    <tr key={a.author} className="num border-b border-line last:border-0">
                      <td className="px-3 py-2"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${m.provider})` }} />{m.label}</td>
                      <td className="px-3 py-2 text-right">{a.candidates} / {a.selected}</td>
                      <td className="px-3 py-2 text-right">{a.scoreFromOthers?.toFixed(1) ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{a.scoreFromSelf?.toFixed(1) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {notes.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">実験で気づいたこと</h2>
          <ol className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="card p-4">
                <div className="flex flex-wrap gap-2 text-xs text-muted">
                  <span className="num">{n.at.slice(0, 10)}</span>
                  <span>{NOTE_TOPICS[n.topic]}</span>
                  <span>{NOTE_CERTAINTY[n.certainty].label}</span>
                </div>
                <h3 className="mt-1 font-bold">{n.title}</h3>
                {n.body && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{n.body}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="border-t border-line pt-4 text-xs text-muted">数字は自動で更新されます。件数が少ないうちの差は、偶然の可能性が高いことにご注意ください。</footer>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}
