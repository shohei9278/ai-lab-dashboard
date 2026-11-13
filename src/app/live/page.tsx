import { redirect } from "next/navigation";

// ライブは、ホームのオフィスの下にまとめた（AIの社員の様子と、会話・処理のログを一緒に見せる）。前のURLから来た人は、そこへ移す
export default function LivePage() {
  redirect("/#live");
}
