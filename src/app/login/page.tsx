import { PageIntro } from "@/components/PageIntro";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <PageIntro title="運営者のログイン">
        操作できるのは運営者だけです。見に来てくださった方は、ログインしなくても全部の画面を見られます（ボタンは押せません）。
      </PageIntro>
      <LoginForm />
    </div>
  );
}
