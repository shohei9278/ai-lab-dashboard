import { SITE_NAME } from "@/lib/site";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">{SITE_NAME}</h1>
      <p className="mt-3 text-ink-2">小さなWebサービスを企画・準備しています。各サービスの事前登録ページは個別のURLでご案内しています。</p>
    </main>
  );
}
