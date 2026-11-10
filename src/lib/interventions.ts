import { db } from "./db";
import { jstDay } from "./sns";

// 人の手が入った記録: コードはClaude Codeが書いているが、問題を見つけ、原因を判断し、直し方を決めたのは人。その記録を残して公開する

export type InterventionKind = "bug" | "design" | "direction";
export const INTERVENTION_KIND: Record<InterventionKind, string> = { bug: "不具合", design: "仕組みの変更", direction: "方針の判断" };
export type InterventionRow = { id: number; day: string; kind: InterventionKind; title: string; happened: string; noticed: string; decision: string; commit_sha: string | null };

export const commitUrl = (sha: string) => `https://github.com/shohei9278/ai-lab-dashboard/commit/${sha}`;

// これまでの実際の事例。key ごとにコードの内容で更新するので、文面やコミットを直せば次の起動で反映される（消した記録は消したまま）
const FIRST: (Omit<InterventionRow, "id"> & { key: string })[] = [
  { key: "count-mismatch", day: "2026-11-10", kind: "bug", title: "集客の件数が 4/3件 になっていた", happened: "投稿の上限より実際の件数が多く見える表示になっていた。分母が古い設定のままで、分子も実際の判定と数え方が違っていた。", noticed: "運営者が画面を見て「集客のところ直近24時間 4/3件みたいなテキストになるんだけど分母と分子あってる？」と指摘した。", decision: "表示を、実際に投稿を止める安全装置と同じ数え方にそろえた。", commit_sha: "e3c21d8" },
  { key: "real-screen-video", day: "2026-11-09", kind: "direction", title: "字幕の動画より、本物の画面を見せる", happened: "AIが台本を書いた字幕だけの動画を作れるようにしたが、普通のテキスト動画に見えた。", noticed: "運営者が見本を見て「もっとダッシュボードの動きとか見せられた動画とかの方が面白そうだけどね」と提案した。", decision: "ゲスト用の本物の画面を順に映す動画を追加した。字幕の数字は記録から入れ、AIは使わない。", commit_sha: "3120b11" },
  { key: "video-memory", day: "2026-11-09", kind: "bug", title: "本番のサーバーで動画を作れなかった", happened: "手元では動いた動画の変換が、本番ではエラーで止まった。メモリ不足で強制終了されたと見ている。", noticed: "運営者が本番のボタンを押して、エラーを見つけた。", decision: "変換の設定を見直して、使用メモリのピークを約720MBから約130MBに下げ、変換の前にブラウザを閉じるようにした。", commit_sha: "5d50a0a" },
  { key: "notify-diary", day: "2026-11-09", kind: "design", title: "通知を「やったこと」だけにし、日報とまとめを1つにした", happened: "Discordに「これから」の通知が流れ、夜の日報と1日のまとめも別の処理で別の時刻に動いていた。", noticed: "運営者が「discordのこれからって投稿いらない」「そもそも日報とまとめの処理一緒で良いのでは」と指摘した。", decision: "始めるときの通知をやめ、夜の処理を「日報を書いて、そのままDiscordに送る」1つにした。", commit_sha: "c01f40a" },
  { key: "new-axis", day: "2026-11-09", kind: "design", title: "AIに「別軸」の提案もさせる", happened: "提案箱に入るのは今のやり方の改善ばかりで、動画のような新しい手はAIから出ていなかった。", noticed: "運営者が「こういう提案も提案箱に入るようになると良いな」と指摘した。", decision: "定例会議で、まだ試していない手を別の基準で採点し、一番良いものを1件は提案箱に入れるようにした。", commit_sha: "c01f40a" },
  { key: "tool-cut-53", day: "2026-11-09", kind: "bug", title: "ツール作成が途中で切れて、1回で約96円が無駄になった", happened: "案件#53のコードを書くAIが出力の上限（6.4万トークン）まで使い切って止まった。ふだんは最大でも3.8万トークンほど。", noticed: "運営者が「あと53の案件がまた 出力が長すぎて途中で切れましたになった」と失敗を報告して、調査を指示した。", decision: "上限を下げ、切れたら別の会社のAIに規模を絞って1回だけ書き直させるようにした。", commit_sha: "58b8fd9" },
  { key: "hold-status", day: "2026-11-09", kind: "design", title: "案件に「保留」を作った", happened: "季節もののように今は集客しても届かない案件も、撤退か継続かの判断に進んでしまう作りだった。", noticed: "運営者が「案件の保留ってステータスは必要だと思う？」と問いかけた。", decision: "公開と記録は続けて、宣伝・判断・改善だけを止める状態を追加した。保留にできるのは人だけで、理由と再開日を必須にした。", commit_sha: "58b8fd9" },
  { key: "improve-cut-36", day: "2026-11-09", kind: "bug", title: "ツールの改善が失敗し、約59円が2回無駄になった", happened: "文章を直すAIにツールのプログラム全文を渡していたため、書き返そうとして出力が切れ、結果を読めなくなっていた。", noticed: "運営者が失敗を見て「以下失敗の原因は？ 他の処理とぶつかったかな」と調査を指示した。", decision: "文章を直すAIにはプログラムを渡さず、シェア文だけ引き継ぐようにした。", commit_sha: "6c5a8d5" },
  { key: "mobile-overflow", day: "2026-11-06", kind: "bug", title: "スマホで画面が横にはみ出していた", happened: "ダッシュボードの一部がスマホ幅で横にはみ出し、スクロールが必要になっていた。", noticed: "運営者が「ダッシュボードのスマホ表示が横スクロールしちゃったりしてきになる」と指摘した。", decision: "幅の計算と長い文字の折り返しを直した。", commit_sha: "3bb115d" },
  { key: "three-company-ideas", day: "2026-11-05", kind: "direction", title: "アイデア出しを3社の競争にした", happened: "設定した1社のAIだけがアイデアを出していて、会社どうしを比べられなかった。", noticed: "運営者が「AIにアイデアを出させるって 設定したAIだけが思考するっけ？」と問いかけて、作り方を比べたうえで決めた。", decision: "Claude・GPT・Geminiが案を出し、作者を伏せて採点し合う形に変えた。", commit_sha: "29973d3" },
];

const g = globalThis as unknown as { __aiLabInterventionsSeeded?: boolean };

function seedOnce() {
  if (g.__aiLabInterventionsSeeded) return;
  const update = db().prepare("UPDATE interventions SET day = ?, kind = ?, title = ?, happened = ?, noticed = ?, decision = ?, commit_sha = ? WHERE seed_key = ?");
  const insert = db().prepare("INSERT INTO interventions (day, kind, title, happened, noticed, decision, commit_sha, seed_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  db().transaction(() => {
    for (const x of [...FIRST].reverse()) {
      const v = [x.day, x.kind, x.title, x.happened, x.noticed, x.decision, x.commit_sha, x.key];
      if (!update.run(...v).changes) insert.run(...v);
    }
  })();
  g.__aiLabInterventionsSeeded = true;
}

export function listInterventions(limit = 200): InterventionRow[] {
  seedOnce();
  return db().prepare("SELECT * FROM interventions WHERE hidden = 0 ORDER BY day DESC, id DESC LIMIT ?").all(limit) as InterventionRow[];
}

export function addIntervention(v: Record<string, unknown>): number {
  const text = (k: string, max: number) => String(v[k] ?? "").trim().slice(0, max);
  const title = text("title", 80), happened = text("happened", 400), noticed = text("noticed", 300), decision = text("decision", 400), sha = text("commit", 40);
  const kind = (["bug", "design", "direction"].includes(String(v.kind)) ? v.kind : "bug") as InterventionKind;
  if (!title || !happened || !noticed || !decision) throw new Error("題・起きたこと・どう気づいたか・判断は、すべて書いてください");
  if (sha && !/^[0-9a-f]{7,40}$/.test(sha)) throw new Error("コミットは英数字のIDで入れてください");
  seedOnce();
  const day = jstDay();
  return Number(db().prepare("INSERT INTO interventions (day, kind, title, happened, noticed, decision, commit_sha) VALUES (?, ?, ?, ?, ?, ?, ?)").run(day, kind, title, happened, noticed, decision, sha || null).lastInsertRowid);
}

export function hideIntervention(id: number) {
  db().prepare("UPDATE interventions SET hidden = 1 WHERE id = ?").run(id);
}
