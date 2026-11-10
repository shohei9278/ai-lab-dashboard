import { HIDDEN, isOwner } from "@/lib/viewer";
import { getSettings } from "@/lib/db";
import { MODELS, PROVIDER_ENV, PROVIDER_LABEL, hasKey, type Provider } from "@/lib/models";
import { SettingsForm } from "./SettingsForm";
import { AUTO_PLATFORMS } from "@/lib/snsApi";
import { notifyConfigured } from "@/lib/notify";
import { backupList, offsiteState } from "@/lib/backup";
import { publishingConfigured } from "@/lib/publish";
import { PageIntro } from "@/components/PageIntro";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const owner = await isOwner();
  // 来た人には、連絡先や運営者名は伏せる（何を決められるかは見せる）
  const s = owner ? getSettings() : { ...getSettings(), contactEmail: HIDDEN, operatorName: HIDDEN };
  const providers = [...new Set(MODELS.map((m) => m.provider))] as Provider[];
  return (
    <div className="space-y-6">
      <PageIntro title="設定">AIが使えるお金の上限、案件を判断する基準、製品ループで使うAIを決めます。</PageIntro>
      <SettingsForm initial={s} models={MODELS.map((m) => ({ id: m.id, label: m.label, ok: hasKey(m.provider) }))} publishing={publishingConfigured()} notifyReady={notifyConfigured()} backups={owner ? { files: backupList().slice(0, 3).map((b) => b.file), offsite: offsiteState() } : null} snsReady={Object.entries(AUTO_PLATFORMS).map(([key, d]) => ({ key, label: d.label, ok: d.configured(), free: d.costUsd === 0, promoYen: Math.round(d.costUsd * s.usdJpy), plainYen: Math.round(d.plainCostUsd * s.usdJpy) }))} />

      <section className="space-y-2">
        <h2 className="font-bold">APIキー</h2>
        <div className="card divide-y divide-line text-sm">
          {providers.map((p) => (
            <div key={p} className="flex items-center justify-between px-3 py-2">
              <span>{PROVIDER_LABEL[p]} <code className="text-xs text-muted">{PROVIDER_ENV[p]}</code></span>
              <span style={{ color: hasKey(p) ? "var(--good)" : "var(--muted)" }}>{hasKey(p) ? "✓ 設定済み" : "— 未設定"}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">キーはこの画面では入力できません。<code>.env.local</code> に書いて、サーバーを再起動してください。</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">モデルと料金（100万トークンあたり）</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2">モデル</th>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2 text-right">入力</th>
                <th className="px-3 py-2 text-right">出力</th>
                <th className="px-3 py-2">確認</th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m) => (
                <tr key={m.id} className="num border-b border-line last:border-0">
                  <td className="px-3 py-2">{m.label}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-2">{m.id}</td>
                  <td className="px-3 py-2 text-right">${m.inputPerM}</td>
                  <td className="px-3 py-2 text-right">${m.outputPerM}</td>
                  <td className="px-3 py-2 text-xs">{m.verified ? "公式" : <span style={{ color: "var(--critical)" }}>▲ 要確認</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">モデルIDと料金は <code>src/lib/models.ts</code> で変更できます。</p>
      </section>
    </div>
  );
}
