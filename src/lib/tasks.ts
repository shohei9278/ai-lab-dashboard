import classification from "@/data/classification.json";
import extraction from "@/data/extraction.json";

export type TaskType = "classification" | "extraction";
export type PromptVariant = "basic" | "detailed";
export type PromptLang = "ja" | "en";

export type Item = {
  id: string;
  author: string; // 問題を作った人 or AI（作成者バイアスの検証用）
  input: string;
  answer: string | Record<string, string | number>;
};

export type Dataset = {
  task: TaskType;
  title: string;
  items: Item[];
  labels?: string[];
  fields?: string[];
};

export const DATASETS: Record<TaskType, Dataset> = {
  classification: classification as Dataset,
  extraction: extraction as Dataset,
};

export const TASK_LABEL: Record<TaskType, string> = {
  classification: "問い合わせ分類",
  extraction: "請求書データ抽出",
};

export const VARIANT_LABEL: Record<PromptVariant, string> = {
  basic: "シンプル",
  detailed: "詳細",
};

export const LANG_LABEL: Record<PromptLang, string> = {
  ja: "日本語",
  en: "英語",
};

export function buildPrompt(
  ds: Dataset,
  item: Item,
  variant: PromptVariant,
  lang: PromptLang,
): { system: string; user: string } {
  if (ds.task === "classification") {
    const labels = ds.labels!.join(" / ");
    const system =
      lang === "ja"
        ? variant === "basic"
          ? `問い合わせ文を次のどれか1つに分類してください: ${labels}\nJSON {"label": "..."} だけを返してください。`
          : `あなたはカスタマーサポートの一次振り分け担当です。問い合わせ文を読み、次のラベルから最も当てはまるものを1つだけ選んでください: ${labels}\n- 解約: 契約の終了・退会・停止を求めている\n- クレーム: 不満・不具合・損害への対応を求めている\n- 要望: 機能やサービスの追加・改善の提案\n- 質問: 仕様や手続きについて知りたいだけ\n複数に当てはまる場合は、問い合わせ者が最終的に求めている行動を優先してください。\n出力は JSON {"label": "..."} のみ。説明は不要です。`
        : variant === "basic"
          ? `Classify the customer message into exactly one of these labels: ${labels}\nReturn only JSON {"label": "..."} using the label text as given.`
          : `You triage customer support messages. Read the message (in Japanese) and pick the single best label from: ${labels}\n- 解約: wants to end, cancel or stop the contract\n- クレーム: complains about a problem, defect or damage and wants it handled\n- 要望: suggests a new feature or an improvement\n- 質問: only wants information about specs or procedures\nIf several apply, prefer the action the customer ultimately wants.\nReturn only JSON {"label": "..."} using the label text exactly as given. No explanation.`;
    return { system, user: item.input };
  }

  const fields = ds.fields!.join(", ");
  const system =
    lang === "ja"
      ? variant === "basic"
        ? `請求書から次の項目を抜き出して JSON で返してください: ${fields}\n日付は YYYY-MM-DD、total は数値にしてください。JSON だけを返してください。`
        : `あなたは経理担当です。請求書のテキストから次の項目を抽出し、JSON オブジェクトだけを返してください。\n- vendor: 請求書の発行元（請求先ではない）\n- invoice_number: 現在の請求番号（旧番号や見積番号ではない）\n- issue_date: 発行日（YYYY-MM-DD）\n- due_date: 支払期限（YYYY-MM-DD。「月末」などは具体的な日付に直す）\n- total: 今回実際に支払う金額（数値、円、カンマなし）\n説明やコードブロックは不要です。`
      : variant === "basic"
        ? `Extract these fields from the invoice and return JSON: ${fields}\nUse YYYY-MM-DD for dates and a number for total. Return only JSON.`
        : `You are an accountant. Extract these fields from the invoice text (in Japanese) and return only a JSON object.\n- vendor: the issuer of the invoice (not the billed party), as written\n- invoice_number: the current invoice number (not an old number or a quote number)\n- issue_date: issue date (YYYY-MM-DD)\n- due_date: payment due date (YYYY-MM-DD; turn phrases like "end of month" into a concrete date)\n- total: the amount actually to be paid this time (number in JPY, no commas)\nNo explanation, no code fences.`;
  return { system, user: item.input };
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normDate(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return s;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function normNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
}

export type Grade = {
  formatOk: boolean;
  correct: boolean;
  score: number; // 0〜1。抽出は項目ごとの正解割合
  canonical: string; // ブレ測定用に正規化した回答
};

export const INVALID = "__INVALID__";

export function grade(ds: Dataset, item: Item, output: string): Grade {
  const parsed = extractJson(output) as Record<string, unknown> | null;

  if (ds.task === "classification") {
    let label = parsed && typeof parsed.label === "string" ? parsed.label.trim() : null;
    const formatOk = label !== null && ds.labels!.includes(label);
    if (!formatOk) {
      const hits = ds.labels!.filter((l) => output.includes(l));
      label = hits.length === 1 ? hits[0] : null;
    }
    const correct = label === item.answer;
    return { formatOk, correct, score: correct ? 1 : 0, canonical: label ?? INVALID };
  }

  if (!parsed || typeof parsed !== "object") {
    return { formatOk: false, correct: false, score: 0, canonical: INVALID };
  }
  const answer = item.answer as Record<string, string | number>;
  const norm: Record<string, string | number | null> = {
    vendor: String(parsed.vendor ?? "").trim(),
    invoice_number: String(parsed.invoice_number ?? "").trim(),
    issue_date: normDate(parsed.issue_date),
    due_date: normDate(parsed.due_date),
    total: normNumber(parsed.total),
  };
  const fields = ds.fields!;
  const hits = fields.filter((f) => norm[f] === answer[f]).length;
  return {
    formatOk: true,
    correct: hits === fields.length,
    score: hits / fields.length,
    canonical: JSON.stringify(fields.map((f) => norm[f])),
  };
}
