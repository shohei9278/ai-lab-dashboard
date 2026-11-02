import { CONTACT_EMAIL, POLICY_UPDATED, SITE_NAME } from "@/lib/site";

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

      <Section title="5. 保管期間と削除">
        <p>サービスの提供開始のご案内を終えたとき、またはサービスを開発しないと決めたときは、メールアドレスを速やかに削除します。ご本人からのご依頼があれば、いつでも削除します。</p>
      </Section>

      <Section title="6. 開示・訂正・削除などのご請求">
        <p>ご自身の情報の開示・訂正・利用停止・削除をご希望の場合は、下記の連絡先までご連絡ください。ご本人であることを確認したうえで対応します。</p>
      </Section>

      <Section title="7. お問い合わせ先">
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
