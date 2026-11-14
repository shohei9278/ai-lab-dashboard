import { STATUS_LABEL } from "@/lib/format";

const STATUS_STYLE: Record<string, { color: string; icon: string }> = {
  queued: { color: "var(--muted)", icon: "○" },
  running: { color: "var(--accent)", icon: "◐" },
  done: { color: "var(--good)", icon: "✓" },
  stopped: { color: "var(--warning)", icon: "■" },
  error: { color: "var(--critical)", icon: "!" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.queued;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2">
      <span aria-hidden style={{ color: s.color }}>{s.icon}</span>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function MockBadge({ mock }: { mock: boolean }) {
  return mock ? (
    <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">ダミー</span>
  ) : (
    <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink">実API</span>
  );
}

export function Stat({ label, value, sub, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-2">{sub}</div>}
      {children}
    </div>
  );
}

export function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="card space-y-1 border-l-4 p-3 text-sm" style={{ borderLeftColor: "var(--warning)" }}>
      {items.map((w) => (
        <li key={w} className="flex gap-2">
          <span aria-hidden style={{ color: "var(--warning)" }}>▲</span>
          <span><span className="sr-only">注意: </span>{w}</span>
        </li>
      ))}
    </ul>
  );
}
