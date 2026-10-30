import { MODELS, PROVIDER_LABEL, hasKey } from "@/lib/models";
import { DATASETS, TASK_LABEL, type TaskType } from "@/lib/tasks";
import { NewRunForm } from "./NewRunForm";

export const dynamic = "force-dynamic";

export default function NewRunPage() {
  const models = MODELS.map((m) => ({ ...m, providerLabel: PROVIDER_LABEL[m.provider], hasKey: hasKey(m.provider) }));
  const tasks = (Object.keys(DATASETS) as TaskType[]).map((t) => ({ id: t, label: TASK_LABEL[t], items: DATASETS[t].items.length }));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">新規実行</h1>
      <NewRunForm models={models} tasks={tasks} />
    </div>
  );
}
