import { db } from "./db";
import { simulatedDays, getProject, projectTotals, type Decision, type Lp } from "./loop";

// AIを呼ばずに画面の流れを確認するためのデモ案件。demo = 1 で保存し、まとめて消せる

type DemoProject = {
  title: string; target: string; problem: string; solution: string; hypothesis: string; reason: string; confidence: number;
  stage: "idea" | "lp" | "live" | "deciding" | "killed" | "continued";
  days?: number;
  decision?: Decision;
  lesson?: string;
};

const lp = (title: string, target: string): Lp => ({
  headline: `${target}の面倒な作業を、${title}で5分に。`,
  subheadline: "いま事前登録いただいた方に、公開時に最初にご案内します。",
  pains: ["毎回同じ確認を手作業でしている", "抜け漏れに後から気づく", "ツールを入れるほどではないと思っている"],
  features: [
    { title: "登録だけで使える", body: "アカウントを作ればすぐに使えます。設定はほとんど不要です。" },
    { title: "スマホで完結", body: "移動中でも確認と操作ができます。" },
    { title: "小さく始められる", body: "まずは無料で試して、合えば続けられます。" },
  ],
  cta: "公開時に案内を受け取る（無料）",
  faq: [
    { q: "いつ使えるようになりますか？", a: "需要を確認したうえで開発します。公開が決まったらメールでお知らせします。" },
    { q: "料金はかかりますか？", a: "事前登録は無料です。" },
  ],
});

const PROJECTS: DemoProject[] = [
  {
    title: "宿題ピッカー", target: "週に5回以上オンライン会議に出る営業職", problem: "会議のあとで誰が何をやるか（宿題）が曖昧になる",
    solution: "議事録を貼るだけで、担当者と期限つきの宿題リストに整理する", hypothesis: "LP訪問者の4%以上が事前登録する",
    reason: "議事録ツールは多いが「宿題の追跡」に絞ったものは少ない", confidence: 0.6, stage: "idea",
  },
  {
    title: "シフト希望ポスト", target: "アルバイト10〜30人の飲食店の店長", problem: "シフト希望をLINEで個別に集めて、表にまとめるのに毎月2時間かかる",
    solution: "URLを送るだけで希望を回収し、カレンダー形式に自動でまとめる", hypothesis: "LP訪問者の3%以上が事前登録する",
    reason: "店長本人の手間が大きく、課金意欲が見込める", confidence: 0.55, stage: "lp",
  },
  {
    title: "引越しやることリスト", target: "初めて一人暮らしの引越しをする20代", problem: "住所変更や解約の手続きが多く、何から手をつけるか分からない",
    solution: "引越し日と住んでいる地域を入れると、期限つきの手続きリストを作る", hypothesis: "LP訪問者の5%以上が事前登録する",
    reason: "検索需要が季節的に大きい", confidence: 0.5, stage: "live", days: 1,
  },
  {
    title: "子どもの持ち物チェッカー", target: "小学生の子どもがいる共働きの親", problem: "学校からのお便りの持ち物を見落とす",
    solution: "お便りの写真から持ち物と期限を抜き出して通知する", hypothesis: "LP訪問者の4%以上が事前登録する",
    reason: "毎週発生する困りごとで、継続利用が見込める", confidence: 0.35, stage: "deciding", days: 3,
    decision: {
      decision: "kill", confidence: 0.7,
      reason: "",
      next_action: "撤退し、「親向け」より「学校・塾向け」の切り口を次のアイデアで検討する",
    },
  },
  {
    title: "経費メモ写真", target: "領収書をため込みがちなフリーランス", problem: "月末に領収書をまとめて入力するのが苦痛",
    solution: "領収書を撮るだけで日付と金額を記録し、月末にCSVで書き出す", hypothesis: "LP訪問者の3%以上が事前登録する",
    reason: "既存の会計ソフトは多機能すぎる", confidence: 0.3, stage: "killed", days: 3,
    lesson: "会計まわりは既存の無料アプリが強く、「写真で記録」だけでは差別化にならない。乗り換えの理由を最初に示せる案を優先する。",
  },
  {
    title: "面接日程さくっと", target: "採用担当が1人しかいない従業員20〜50人の会社", problem: "候補者との面接日程の調整に、1人あたり平均5往復かかる",
    solution: "空き時間を共有するだけで、候補者が自分で面接枠を予約できる", hypothesis: "LP訪問者の3%以上が事前登録する",
    reason: "担当者1人の会社は専用ツールを入れておらず、困りごとが大きい", confidence: 0.75, stage: "continued", days: 3,
    lesson: "担当者が1人しかいない業務は、困りごとが大きく反応が良い。「1人で回している人」を狙う案を優先する。",
  },
];

export function seedDemo() {
  const conn = db();
  // デモでも2つのモードが見えるように、交互に割り当てる。LPがあるものは第1版として保存する
  const insert = conn.prepare(
    `INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, ai_confidence, stage, lp, model_id, theme, demo, mode, lp_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', 'デモ', 1, ?, ?)`,
  );
  const ver = conn.prepare("INSERT INTO lp_versions (project_id, version, lp, note, review) VALUES (?, 1, ?, 'デモ', ?)");
  const ev = conn.prepare("INSERT INTO events (project_id, actor, kind, message) VALUES (?, ?, ?, ?)");
  const ap = conn.prepare("INSERT INTO approvals (project_id, kind, status, proposal, reason, payload, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const met = conn.prepare("INSERT INTO metrics (project_id, day, visits, signups, ad_spend_jpy, source) VALUES (?, ?, ?, ?, ?, 'simulated')");
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  conn.transaction(() => {
    for (const [i, d] of PROJECTS.entries()) {
      const hasLp = d.stage !== "idea";
      const lpJson = hasLp ? JSON.stringify(lp(d.title, d.target)) : null;
      const id = Number(insert.run(d.title, d.target, d.problem, d.solution, d.hypothesis, d.reason, d.confidence, d.stage,
        lpJson, i % 2 ? "auto" : "manual", hasLp ? 1 : 0).lastInsertRowid);
      if (lpJson) ver.run(id, lpJson, JSON.stringify({ ok: true, issues: [] }));
      ev.run(id, "ai", "idea", `アイデアを提案: ${d.title}`);
      if (d.stage === "idea") {
        ap.run(id, "idea", "pending", `「${d.title}」で進める`, d.reason, null, null);
        continue;
      }
      ap.run(id, "idea", "approved", `「${d.title}」で進める`, d.reason, null, now);
      ev.run(id, "human", "approval", `承認: 「${d.title}」で進める`);
      ev.run(id, "ai", "lp", `LPを作成: ${lp(d.title, d.target).headline}`);
      if (d.stage === "lp") {
        ap.run(id, "publish", "pending", "このLPを公開して集客を始める", `${d.target}に向けて事前登録を募ります。`, null, null);
        continue;
      }
      ap.run(id, "publish", "approved", "このLPを公開して集客を始める", `${d.target}に向けて事前登録を募ります。`, null, now);
      ev.run(id, "human", "approval", "承認: このLPを公開して集客を始める");
      ev.run(id, "system", "publish", "LPを公開して集客を開始");
      for (const m of simulatedDays(getProject(id)!, d.days ?? 3)) met.run(id, m.day, m.visits, m.signups, m.adSpendJpy);
      ev.run(id, "system", "metrics", "集客データを追加（シミュレーション）");
      if (d.decision) {
        // 判断理由の数字は、実際に入れたシミュレーションの値から作る
        const t = projectTotals(id);
        const decision = { ...d.decision, reason: `訪問${t.visits}人に対して登録は${t.signups}人（${(t.rate * 100).toFixed(1)}%）で、${t.rate < 0.03 ? "目標の3%を下回っています。" : "目標の3%をわずかに上回るものの、件数が少なく偶然の可能性が高いと判断しました。"}` };
        ap.run(id, "decision", "pending", "撤退する", decision.reason, JSON.stringify(decision), null);
        ev.run(id, "ai", "judge", "判断を提案: 撤退する");
      }
      if (d.lesson) {
        ev.run(id, "ai", "judge", d.stage === "killed" ? "判断を提案: 撤退する" : "判断を提案: 続ける（プロダクト化へ）");
        ev.run(id, "human", "approval", "承認");
        conn.prepare("INSERT INTO lessons (project_id, text) VALUES (?, ?)").run(id, d.lesson);
        ev.run(id, "ai", "lesson", `教訓を記録: ${d.lesson}`);
      }
    }
  })();
}

export function clearDemo() {
  const conn = db();
  conn.transaction(() => {
    const ids = "(SELECT id FROM projects WHERE demo = 1)";
    for (const t of ["approvals", "events", "metrics", "lessons", "ai_calls", "lp_versions"]) conn.prepare(`DELETE FROM ${t} WHERE project_id IN ${ids}`).run();
    conn.prepare("DELETE FROM projects WHERE demo = 1").run();
  })();
}
