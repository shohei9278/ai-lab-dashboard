import { CONTACT_EMAIL, GA_MEASUREMENT_ID, POLICY_UPDATED, SITE_NAME } from "@/lib/site";

export const metadata = { title: `プライバシーポリシー｜${SITE_NAME}` };

// 公開前に内容を確認すること。必要に応じて専門家に相談する
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-12 text-sm leading-relaxed">
      <h1 className="text-xl font-bold">プライバシーポリシー</h1>
      <p>{SITE_NAME}（以下「当方」）は、事前登録ページで取得する個人情報を、次のとおり取り扱います。</p>

      <Section title="1. 取得する情報">
        <ul className="ml-5 list-disc">
          <li>事前登録の際に入力いただいたメールアドレス</li>
          <li>ページの閲覧状況（ブラウザごとに割り当てるランダムな識別子、閲覧日、参照元のページ）。個人を特定する目的では使いません</li>
        </ul>
      </Section>

      <Section title="2. 利用目的">
        <ul className="ml-5 list-disc">
          <li>サービスの提供開始など、登録いただいたサービスに関するご案内をお送りするため</li>
          <li>サービスへの関心の大きさを把握し、開発するかどうかや内容を判断するため（閲覧数・登録数などの集計として利用します）</li>
        </ul>
        <p>上記以外の目的には利用しません。登録いただいたサービス以外のご案内を送ることもありません。</p>
      </Section>

      <Section title="3. 第三者への提供">
        <p>法令に基づく場合を除き、ご本人の同意なく第三者に提供しません。</p>
      </Section>

      <Section title="4. 取り扱いの委託">
        <p>ウェブサイトの運営とデータの保管のために、次の事業者のサービスを利用しています。これらの事業者は、日本国外のサーバーでデータを保管・処理する場合があります。</p>
        <ul className="ml-5 list-disc">
          <li>Vercel Inc.（米国）: ウェブサイトの配信</li>
          <li>Supabase Inc.（米国）: データの保管</li>
        </ul>
      </Section>

      {GA_MEASUREMENT_ID && (
        <Section title="5. アクセス解析ツールの利用（外部への情報送信）">
          <p>ページの使われ方を把握して内容を改善するため、Google LLC が提供する「Google アナリティクス」を利用しています。ページを開くと、次の情報がお使いのブラウザから Google に送信されます。</p>
          <ul className="ml-5 list-disc">
            <li>送信先: Google LLC（米国）</li>
            <li>送信される情報: 閲覧したページのURL、参照元、閲覧日時、ブラウザ・端末・おおよその地域の情報、Cookie に保存される識別子、ページ内での操作（どの部分まで読んだか、登録ボタンを押したか、登録が完了したか）</li>
            <li>利用目的: 閲覧数や操作の集計によるページの改善</li>
          </ul>
          <p>メールアドレスなど、個人を直接特定できる情報は送信しません。Google による情報の取り扱いは <a href="https://policies.google.com/technologies/partner-sites?hl=ja" target="_blank" rel="noreferrer" className="underline">Google のポリシー</a> をご覧ください。送信を止めたい場合は、<a href="https://tools.google.com/dlpage/gaoptout?hl=ja" target="_blank" rel="noreferrer" className="underline">Google アナリティクス オプトアウト アドオン</a> をご利用ください。</p>
        </Section>
      )}

      <Section title={`${GA_MEASUREMENT_ID ? 6 : 5}. 保管期間と削除`}>
        <p>サービスの提供開始のご案内を終えたとき、またはサービスを開発しないと決めたときは、メールアドレスを速やかに削除します。ご本人からのご依頼があれば、いつでも削除します。</p>
      </Section>

      <Section title={`${GA_MEASUREMENT_ID ? 7 : 6}. 開示・訂正・削除などのご請求`}>
        <p>ご自身の情報の開示・訂正・利用停止・削除をご希望の場合は、下記の連絡先までご連絡ください。ご本人であることを確認したうえで対応します。</p>
      </Section>

      <Section title={`${GA_MEASUREMENT_ID ? 8 : 7}. お問い合わせ先`}>
        <p>運営: {SITE_NAME}</p>
        <p>連絡先: {CONTACT_EMAIL || "（未設定）"}</p>
      </Section>

      <p className="text-muted">制定日: {POLICY_UPDATED}</p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-bold">{title}</h2>
      {children}
    </section>
  );
}
