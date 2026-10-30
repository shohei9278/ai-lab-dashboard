import { db, getSettings, type RunRow } from "@/lib/db";
import { RunsTable } from "@/components/RunsTable";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const runs = db().prepare("SELECT * FROM runs ORDER BY id DESC").all() as RunRow[];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">実行履歴</h1>
      <RunsTable runs={runs} usdJpy={getSettings().usdJpy} />
    </div>
  );
}
