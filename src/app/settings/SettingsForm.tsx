"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApprovalMode, Settings } from "@/lib/db";

const MODES: { id: ApprovalMode; label: string; body: string }[] = [
  { id: "manual", label: "毎回承認", body: "アイデアの採用・LPの公開・改善・撤退のすべてで、あなたの承認を待ちます。" },
  { id: "auto", label: "自動で進める", body: "アイデアの採用とLPの改善はAIが進めます。最初の公開と、続ける・撤退の判断だけ承認します。" },
  { id: "alternate", label: "交互（比較用）", body: "新しい案件を2つのモードに交互に割り当てて、結果を比べます。" },
  { id: "confidence", label: "AIの自信で決める", body: "AIの自信が基準以上の案件だけ自動で進め、それ以外は毎回承認にします。「AIの自信は当たるのか」を確かめられます。" },
];

export function SettingsForm({ initial, models, publishing, snsReady, notifyReady, backups }: {
  initial: Settings; models: { id: string; label: string; ok: boolean }[]; publishing: boolean; snsReady: { key: string; label: string; ok: boolean; free: boolean; promoYen: number; plainYen: number }[]; notifyReady: boolean; backups: string[];
}) {
  const router = useRouter();
  const [v, setV] = useState({
    ...initial,
    targetPct: Math.round(initial.targetSignupRate * 1000) / 10,
    autoConfidencePct: Math.round(initial.autoConfidence * 100),
    useRatePct: Math.round(initial.targetUseRate * 100),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const num = (k: keyof typeof v) => ({
    value: v[k] as number,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never),
  });

  async function save() {
    const { targetPct, autoConfidencePct, useRatePct, lastDailyRun, lastWeeklyReport, killSwitch, ...rest } = v;
    void lastWeeklyReport;
    void lastDailyRun; void killSwitch; // 画面からは変えない
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rest, targetSignupRate: targetPct / 100, autoConfidence: autoConfidencePct / 100, targetUseRate: useRatePct / 100 }),
    });
    const data = await res.json();
    setMsg(res.ok ? "保存しました" : data.error);
    router.refresh();
  }

  const input = "num block w-32 rounded-lg border border-line bg-surface px-2 py-1";
  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <h2 className="font-bold">進め方（モード）</h2>
        <p className="text-xs text-muted">新しく作られる案件に適用されます。すでにある案件のモードは変わりません。下の「全自動」をオンにしない限り、最初の公開と、続ける・撤退の判断は、どのモードでも人が承認します。</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {MODES.map((m) => (
            <label key={m.id} className={`cursor-pointer rounded-lg border p-3 text-sm ${v.approvalMode === m.id ? "border-accent" : "border-line"}`}>
              <div className="flex items-center gap-2 font-medium">
                <input type="radio" name="mode" checked={v.approvalMode === m.id} onChange={() => set("approvalMode", m.id)} />
                {m.label}
              </div>
              <p className="mt-1 text-xs text-ink-2">{m.body}</p>
            </label>
          ))}
        </div>
        {v.approvalMode === "confidence" && (
          <Field
            label="自動モードにする自信の基準（%）"
            note="毎日の自動実行では、アイデアを出したAI以外の2社による採点の平均（10点満点）を%にして使います（7点なら70%）。手動で依頼したアイデアは、AIの自己申告の自信度を使います。"
          >
            <input type="number" min={0} max={100} {...num("autoConfidencePct")} className={input} />
          </Field>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.fullAuto} onChange={(e) => set("fullAuto", e.target.checked)} />
          <span>
            全自動（自動モードの案件は、公開・続ける・撤退も人の承認なしで行う）
            <span className="block text-xs text-muted">AIのチェックとデザインの確認を通ったものだけ自動で公開し、通らなかったものは人の承認に回します。動くツールの改善も、ブラウザでの自動テストを通れば差し替えます。広告費の上限を超えて集客を続ける判断だけは人に回します。公開したものはホームの一覧に「AIだけで公開（確認）」として出るので、あとから見て「問題なし」「出すべきでなかった」の印を付けてください。</span>
          </span>
        </label>
        {v.fullAuto && (
          <Field label="人の承認なしで新しく公開してよい件数（直近7日）" note="これを超えた分は、人の承認に回します。">
            <input type="number" min={0} {...num("autoPublishPerWeek")} className={input} />
          </Field>
        )}
        <Field label="自動モードで、承認なしにLPを改善してよい回数" note="これを超えたら人の判断に回します。改善は1回に1か所だけ、対象読者と仮説は変えません。">
          <input type="number" min={0} {...num("maxAutoImprove")} className={input} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.shadowJudge} onChange={(e) => set("shadowJudge", e.target.checked)} />
          <span>
            判断の裏比較を行う
            <span className="block text-xs text-muted">AIが判断するたびに、他社の上位AIにも同じ判断をさせて記録します（1回あたり約3〜8円の上乗せ）。結果は「AIの使い分け」で見られます。</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.debateEnabled} onChange={(e) => set("debateEnabled", e.target.checked)} />
          <span>
            AIの判断が割れたら議論させる
            <span className="block text-xs text-muted">裏比較で意見が割れたときだけ、各AIに1回反論させて要約します（割れたときだけ1回あたり約10円の上乗せ）。</span>
          </span>
        </label>
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">毎日の自動アイデア出し</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.dailyEnabled} onChange={(e) => set("dailyEnabled", e.target.checked)} />
            有効にする
          </label>
        </div>
        <p className="text-xs text-muted">
          毎日1回、3社のAI（Claude・GPT・Gemini）がそれぞれアイデアを出し、作者を伏せて3社全員で採点して、平均点の上位を進めます（自動モードの案件はLPまで作ります）。費用の目安は1日25〜35円です。
          このアプリ（サーバー）が起動している間だけ動きます。
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="実行する時刻（この時以降）"><input type="number" min={0} max={23} {...num("dailyHour")} className={input} /></Field>
          <Field label="1社あたりのアイデア数"><input type="number" min={1} max={5} {...num("dailyIdeaCount")} className={input} /></Field>
          <Field label="そのうち進める数（3社の合計から）"><input type="number" min={1} max={5} {...num("dailyKeep")} className={input} /></Field>
          <Field label="承認待ちの上限" note="これ以上たまっていたら、その日は休みます。"><input type="number" min={1} {...num("maxPending")} className={input} /></Field>
          <Field label="集客中の上限" note="これ以上あれば、その日は休みます。"><input type="number" min={1} {...num("maxLive")} className={input} /></Field>
          <Field label="承認待ちの期限（日）" note="過ぎたら自動で見送りにします。"><input type="number" min={1} {...num("staleDays")} className={input} /></Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.weeklyReport} onChange={(e) => set("weeklyReport", e.target.checked)} />
          <span>
            毎週月曜に、定例会議を開く
            <span className="block text-xs text-muted">3社のAIが1週間を振り返って改善案を出し合い、互いに採点して上位を提案箱に入れます。議長のAIが、まとめと発信用の下書き（Xの投稿・記事）も作ります（1回 約60〜80円）。会議の中身は「会議室」、下書きは「資料 → 発信の下書き」で見られます。オフにしても、会議室の「今すぐ会議」と資料の「今すぐ定例会議を開く」は使えます。</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.illustrations} onChange={(e) => set("illustrations", e.target.checked)} />
          <span>
            LPにAIが描いたイラストを入れる
            <span className="block text-xs text-muted">最初の版を作るときに、見出しの横に置くイラストを画像生成AIで1枚描きます（1枚 約12円）。文字・ロゴ・実在の人物は描かせません。公開する前にプレビューで確かめてください。</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.freePage} onChange={(e) => set("freePage", e.target.checked)} />
          <span>
            事前登録LPのページ全体を、AIに自由にデザインさせる
            <span className="block text-xs text-muted">決まった部品の組み合わせではなく、AIがサービスごとの世界観を決めてページを丸ごと書きます。スマホとPCの画面を撮ってAIが崩れを確かめ、問題があれば1回直します。Claude と別の会社のAIで2案作り、3社のAIの採点で選びます（1件 約200〜300円）。うまく作れなかったときは部品のLPを使います。動くツールの案件には使いません。</span>
          </span>
        </label>
        <Field
          label="いま話題のネタ（任意）"
          note="アイデア出しのときに、今月・来月の行事（自動で入ります）と一緒にAIに渡します。その年だけの出来事や、気になっている話題を書いてください。例: ドラフト会議が話題、年末の大掃除向けツールを試したい"
        >
          <textarea value={v.trendNotes} onChange={(e) => set("trendNotes", e.target.value)} maxLength={500} rows={2} className="block w-full max-w-2xl rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
        </Field>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="font-bold">判断の基準</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="使うAI" note="アイデア出し・LP作成・チェック・判断・教訓メモで使います。">
            <select value={v.loopModel} onChange={(e) => set("loopModel", e.target.value)} className="block rounded-lg border border-line bg-surface px-2 py-1">
              {models.map((m) => <option key={m.id} value={m.id} disabled={!m.ok}>{m.label}{m.ok ? "" : "（キーなし）"}</option>)}
            </select>
          </Field>
          <Field label="1案件あたりの広告費の上限（円）" note="これに達したら、AIが判断に入ります。">
            <input type="number" min={0} {...num("adBudgetPerProjectJpy")} className={input} />
          </Field>
          <Field
            label="上限を超えたあと、改善に使ってよい追加の広告費（円）"
            note="0にすると、上限に達した案件は「続ける」か「撤退」のどちらかで判断します。金額を入れると、その範囲で1回LPを改善して再挑戦できます（上限＋この金額に達したら、もう一度判断します）。"
          >
            <input type="number" min={0} {...num("improveExtraBudgetJpy")} className={input} />
          </Field>
          <Field label="判断に入る訪問数" note="今のLPの版での訪問がこの人数を超えたら、AIが続ける・改善・撤退を提案します。">
            <input type="number" min={1} {...num("judgeMinVisits")} className={input} />
          </Field>
          <Field label="訪問が少なくても判断する日数" note="公開（または前の判断）からこの日数がたったら、訪問が少なくてもAIが判断します。人が来ていないときは、ページを変えずに投稿の切り口・場所・対象を見直す（集客の見直し）を選べます。見直しは2回まで。">
            <input type="number" min={1} max={60} {...num("judgeAfterDays")} className={input} />
          </Field>
          <Field label="登録率の目標（%）" note="事前登録LPの案件で、これを下回ると撤退の候補になります。">
            <input type="number" min={0.1} step="0.1" {...num("targetPct")} className={input} />
          </Field>
          <Field label="ツールの利用率の目標（%）" note="動くツールの案件で、訪問者のうち実際に使った人の割合。これを下回ると撤退の候補になります。">
            <input type="number" min={1} max={100} {...num("useRatePct")} className={input} />
          </Field>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">公開用LPサイト</h2>
          <span className="text-sm" style={{ color: publishing ? "var(--good)" : "var(--muted)" }}>
            {publishing ? "✓ Supabase に接続済み" : "○ 未設定（公開は手動の前提）"}
          </span>
        </div>
        <p className="text-xs text-muted">
          公開を承認すると、LPがこのURLの下に「/p案件番号」で公開されます。訪問と登録の数は5分ごとに自動で取り込みます。
          接続には <code>.env.local</code> に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です（手順は docs/SETUP-LP.md）。
        </p>
        <Field label="LPサイトのURL（独自ドメイン）">
          <input
            type="url"
            placeholder="https://example.com"
            value={v.lpBaseUrl}
            onChange={(e) => set("lpBaseUrl", e.target.value)}
            className="block w-full max-w-md rounded-lg border border-line bg-surface px-2 py-1"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="運営者名（屋号）" note="撤退したときに、登録者へ送るメールの差出人に使います。">
            <input value={v.operatorName} onChange={(e) => set("operatorName", e.target.value)} maxLength={60} className="block w-full rounded-lg border border-line bg-surface px-2 py-1" />
          </Field>
          <div className="space-y-1 rounded-lg bg-surface-2 p-3 sm:col-span-2">
            <div className="text-sm font-medium">データベースのバックアップ</div>
            <p className="text-xs text-muted">毎日1回、data/backups/ に日付つきの写しを取り、14日分残します（Dropbox の中なので、PCの外にも同期されます）。戻すときは、サーバーを止めて、戻したい日の写しを data/ai-lab.db に置き換えます。</p>
            <p className="text-xs">{backups.length ? `最近の写し: ${backups.join("・")}` : "まだ写しはありません（次の自動の確認で取ります）"}</p>
          </div>
          <div className="space-y-2 rounded-lg bg-surface-2 p-3 sm:col-span-2">
            <div className="text-sm font-medium">スマホへの1日のまとめ</div>
            <p className="text-xs text-muted">
              {notifyReady ? "✓ 送り先が入っています。" : "送り先が入っていないため、送られません（.env.local に NOTIFY_WEBHOOK_URL を入れて、サーバーを再起動してください。手順は docs/SETUP-NOTIFY.md）。"}
              毎日1回、新しい案件・公開・判断・投稿・失敗・あなたの確認待ち・費用をまとめて送ります。
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="送る時刻（日本時間）" note="">
                <input type="number" min={0} max={23} {...num("digestHour")} className={input} />
              </Field>
              <TestNotify disabled={!notifyReady} />
            </div>
          </div>
          <Field label="問い合わせ先のメールアドレス" note="同じく、登録者へ送るメールに載せます（プライバシーポリシーの連絡先と同じものがおすすめ）。">
            <input type="email" value={v.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} className="block w-full rounded-lg border border-line bg-surface px-2 py-1" />
          </Field>
        </div>
        {initial.lpBaseUrl && (
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <div className="font-medium">自分の訪問を数えないようにする</div>
            <p className="mt-1 text-xs text-ink-2">
              確認のために自分でLPを開くと、訪問として数えられてしまいます。使っているブラウザごとに（PC・スマホそれぞれで）、下のリンクを一度開いてください。
              以後そのブラウザでは、訪問・ツールの利用・シェア・登録・GA のどれにも数えません（LPの上に黒い帯が出ます）。元に戻すには <code>?me=0</code> を付けて開きます。
            </p>
            <a href={`${initial.lpBaseUrl.replace(/\/+$/, "")}/?me=1`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-accent underline">
              このブラウザを数えないようにする ↗
            </a>
          </div>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">SNSと毎日の計画</h2>
          <p className="text-xs text-muted">SNSへの自動投稿と、AIが毎朝決める「今日の計画」の設定です。計画の中身と達成度は、ホームの「今日のAIの計画」で見られます（これまでの達成度は<a href="/plan" className="underline">毎日の計画</a>の画面）。</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="LP・ツールを紹介する X のアカウント" note="「SNSで広める」の欄に、どのアカウントで投稿するかを表示します（@なしで入力）。">
            <input value={v.snsAccount} onChange={(e) => set("snsAccount", e.target.value)} maxLength={16} placeholder="hitoride_app" className="block w-full rounded-lg border border-line bg-surface px-2 py-1" />
          </Field>
          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={v.autoPost} disabled={!snsReady.some((x) => x.ok)} onChange={(e) => set("autoPost", e.target.checked)} />
              <span>
                公開中の案件を、AIがSNSに自動で投稿する
                <span className="block text-xs text-muted">
                  使える場所: {snsReady.map((x) => `${x.label} ${x.ok ? "✓" : "—（キー未設定）"}`).join("　")}（キーの入れ方は docs/SETUP-SNS.md）。
                  日本時間の8〜22時に、場所ごとに間隔をあけて投稿します。1つの案件は20時間に1回まで。返信・フォロー・いいねなど、他人への働きかけはしません。
                  X はリンク付きの投稿が1件 約30円（$0.20）かかり、AIの月の予算に含めて数えます。Threads と Bluesky は無料です。自動で投稿するアカウントには、各サービスで「自動化されたアカウント」のラベルを付けてください。
                </span>
              </span>
            </label>
            {v.autoPost && (
              <div className="space-y-1 rounded-lg bg-surface-2 p-3">
                <div className="text-sm font-medium">場所ごとに投稿する種類</div>
                <p className="text-xs text-muted">チェックを外した種類は、その場所には投稿しません（毎日の計画にも入りません）。費用のわりに効いていない場所だけ止める、といった使い方ができます。</p>
                <table className="text-sm">
                  <tbody>
                    {snsReady.filter((x) => x.ok).map((x) => {
                      const toggle = (k: "promoOff" | "plainOff", on: boolean) => {
                        const list = v[k].split(",").map((y) => y.trim()).filter((y) => y && y !== x.key);
                        set(k, (on ? list : [...list, x.key]).join(","));
                      };
                      return (
                        <tr key={x.key}>
                          <td className="py-1 pr-4 font-medium">{x.label}</td>
                          <td className="py-1 pr-4">
                            <label className="inline-flex items-center gap-1">
                              <input type="checkbox" checked={!v.promoOff.split(",").includes(x.key)} onChange={(e) => toggle("promoOff", e.target.checked)} />
                              宣伝の投稿<span className="text-xs text-muted">（1件 約{x.promoYen}円）</span>
                            </label>
                          </td>
                          <td className="py-1">
                            <label className="inline-flex items-center gap-1">
                              <input type="checkbox" checked={!v.plainOff.split(",").includes(x.key)} onChange={(e) => toggle("plainOff", e.target.checked)} />
                              普通の投稿<span className="text-xs text-muted">（1件 約{x.plainYen}円）</span>
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {v.autoPost && !v.dailyPlan && (
              <Field label="自動投稿の上限（場所ごと・直近24時間）" note="">
                <input type="number" min={1} max={10} {...num("autoPostPerDay")} className={input} />
              </Field>
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={v.dailyPlan} onChange={(e) => set("dailyPlan", e.target.checked)} />
              <span>
                毎日の計画（AIが毎朝、全案件を振り返って今日やることを決め、自動で動く）
                <span className="block text-xs text-muted">
                  今のネック（届かない・使われない など）を1つ決めて、宣伝の投稿・宣伝ではない普通の投稿・ページを直す（1日1件まで）・新しい案件づくりを休む、などを決めます。投稿の回数・時刻・場所・切り口もAIが決めます（自動投稿がオンのときだけ投稿します）。
                  計画を作るのは1日1回で約10〜20円、普通の投稿は X で1件 約2円です。計画がある日は、上の「決まった間隔での自動投稿」は止まり、計画に任せます。結果はホームの「今日のAIの計画」で見られます。
                </span>
              </span>
            </label>
            {v.dailyPlan && (
              <Field label="投稿の安全装置（場所ごと・直近24時間）" note="AIの目標ではなく、不具合や行き過ぎを止めるための値です。宣伝と普通の投稿の合計で数えます。届いた日は、処理ログに記録します。">
                <input type="number" min={1} max={50} {...num("postSafetyPerDay")} className={input} />
              </Field>
            )}
          </div>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">実験の公開ページ</h2>
        <p className="text-xs text-muted">
          実験の様子（数字・公開した案件・AIどうしの採点・実験メモ・週のまとめ）を、パスワードなしで見られるページとして出します。発信するときのリンク先に使えます。
          まだ公開していないアイデアや承認待ちの中身は載せません。実験メモは「公開ページに載せる」を付けたものだけ載せます。
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.showcaseEnabled} onChange={(e) => set("showcaseEnabled", e.target.checked)} />
          公開ページを出す（<a href="/showcase" target="_blank" className="text-accent underline">/showcase</a>）
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.showcaseShowLinks} onChange={(e) => set("showcaseShowLinks", e.target.checked)} />
          <span>
            案件のLP・ツールへのリンクを載せる
            <span className="block text-xs text-muted">載せると、公開ページを見た人がLPに来られます。そのかわり、LPの屋号（{initial.lpBaseUrl || "LPサイト"}）とこの実験が結びつきます。</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.showcaseVoices} onChange={(e) => set("showcaseVoices", e.target.checked)} />
          <span>
            社員の声（AIのひとこと）を載せる
            <span className="block text-xs text-muted">最新の12件を載せます。案件の名前も一緒に出ます。</span>
          </span>
        </label>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="font-bold">AI費用の予算</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="月間のAI費用の上限（円）" note="製品ループとテストの合計。超えるとAIの呼び出しが止まります。">
            <input type="number" min={0} {...num("monthlyBudgetJpy")} className={input} />
          </Field>
          <Field label="為替レート（1ドル = 円）">
            <input type="number" min={1} step="0.1" {...num("usdJpy")} className={input} />
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink">保存</button>
        {msg && <span className="text-sm text-ink-2">{msg}</span>}
      </div>
    </div>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="block text-xs text-ink-2">{label}</span>
      {children}
      {note && <span className="block text-xs text-muted">{note}</span>}
    </label>
  );
}

// 1日のまとめを、今すぐ試しに送る
function TestNotify({ disabled }: { disabled: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2 text-xs">
      <button
        type="button"
        disabled={disabled}
        className="rounded-lg border border-line px-3 py-1 disabled:opacity-50"
        onClick={async () => {
          setMsg("送っています…");
          const res = await fetch("/api/notify", { method: "POST" }).catch(() => null);
          const data = res ? await res.json().catch(() => ({})) : {};
          setMsg(res?.ok ? "送りました。スマホを確認してください" : (data.error ?? "送れませんでした"));
        }}
      >
        今すぐ試しに送る
      </button>
      {msg && <span className="text-ink-2">{msg}</span>}
    </div>
  );
}
