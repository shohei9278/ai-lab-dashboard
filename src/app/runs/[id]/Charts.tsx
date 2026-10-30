"use client";

import {
  Bar, BarChart, CartesianGrid, ErrorBar, LabelList, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { ModelStats } from "@/lib/stats";
import type { Provider } from "@/lib/models";

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "anthropic", label: "Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Gemini" },
];

const color = (p: Provider) => `var(--series-${p})`;
const axisTick = { fill: "var(--text-2)", fontSize: 12 };

export function Legend({ providers }: { providers: Provider[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-ink-2">
      {PROVIDERS.filter((p) => providers.includes(p.id)).map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color(p.id) }} />
          {p.label}
        </span>
      ))}
    </div>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-ink">{title}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="num flex justify-between gap-4 text-ink-2">
          <span>{k}</span>
          <span className="text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// 正答率（95%信頼区間つき）
export function AccuracyChart({ models }: { models: ModelStats[] }) {
  const data = [...models]
    .sort((a, b) => b.accuracy - a.accuracy)
    .map((m) => ({ ...m, value: m.accuracy * 100, err: [(m.accuracy - m.ci[0]) * 100, (m.ci[1] - m.accuracy) * 100] }));
  return (
    <ResponsiveContainer width="100%" height={40 + data.length * 36}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--grid)" />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={axisTick} stroke="var(--border)" />
        <YAxis type="category" dataKey="label" width={150} tick={axisTick} stroke="var(--border)" />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const m = payload[0].payload as ModelStats;
            return (
              <TooltipBox
                title={m.label}
                rows={[["正答率", pct(m.accuracy)], ["95%区間", `${pct(m.ci[0])}〜${pct(m.ci[1])}`], ["問題数", `${m.items}問`]]}
              />
            );
          }}
        />
        <Bar dataKey="value" barSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false}
          shape={(props: unknown) => {
            const p = props as { x: number; y: number; width: number; height: number; payload: ModelStats };
            return <rect x={p.x} y={p.y} width={Math.max(0, p.width)} height={p.height} rx={4} fill={color(p.payload.provider)} />;
          }}
        >
          <ErrorBar dataKey="err" direction="x" width={6} stroke="var(--text-2)" strokeWidth={1.5} />
          <LabelList
            dataKey="value"
            content={(props: unknown) => {
              // 数値は信頼区間の右端の外側に置いて、線と重ならないようにする
              const p = props as { x: number; y: number; width: number; height: number; value: number; index: number };
              const d = data[p.index];
              if (!d || !p.value) return null;
              const upperX = p.x + (p.width / p.value) * (d.ci[1] * 100);
              return (
                <text x={upperX + 8} y={p.y + p.height / 2} dominantBaseline="central" fontSize={12} fill="var(--text)">
                  {Math.round(p.value)}%
                </text>
              );
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// 一致率（同じ問題に同じ答えを返した割合）
export function ConsistencyChart({ models }: { models: ModelStats[] }) {
  const data = [...models]
    .filter((m) => m.consistency !== null)
    .sort((a, b) => (b.consistency ?? 0) - (a.consistency ?? 0))
    .map((m) => ({ ...m, value: (m.consistency ?? 0) * 100 }));
  if (!data.length) return <p className="text-sm text-ink-2">繰り返し回数が1回のため、ブレは測定していません。</p>;
  return (
    <ResponsiveContainer width="100%" height={40 + data.length * 36}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--grid)" />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={axisTick} stroke="var(--border)" />
        <YAxis type="category" dataKey="label" width={150} tick={axisTick} stroke="var(--border)" />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const m = payload[0].payload as ModelStats;
            return <TooltipBox title={m.label} rows={[["一致率", pct(m.consistency ?? 0)], ["実行回数", `${m.calls}回`]]} />;
          }}
        />
        <Bar dataKey="value" barSize={14} isAnimationActive={false}
          shape={(props: unknown) => {
            const p = props as { x: number; y: number; width: number; height: number; payload: ModelStats };
            return <rect x={p.x} y={p.y} width={Math.max(0, p.width)} height={p.height} rx={4} fill={color(p.payload.provider)} />;
          }}
        >
          <LabelList dataKey="value" position="right" formatter={(v: unknown) => `${Math.round(Number(v))}%`} style={{ fill: "var(--text)", fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// コスパ: 横軸 = 1回あたりの費用（円）、縦軸 = 正答率
export function CostChart({ models, usdJpy }: { models: ModelStats[]; usdJpy: number }) {
  const data = models.map((m) => ({ ...m, x: m.costPerCallUsd * usdJpy, y: m.accuracy * 100 }));
  const fmt = (v: number) => (v < 1 ? v.toFixed(2) : v.toFixed(1));
  const xs = data.map((d) => d.x).filter((x) => x > 0);
  // 端の点やラベルが切れないよう、左右に余白を取る
  const domain = xs.length ? [Math.min(...xs) / 2, Math.max(...xs) * 2] : [0.01, 1];
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ left: 8, right: 32, top: 24, bottom: 24 }}>
        <CartesianGrid stroke="var(--grid)" />
        <XAxis
          type="number" dataKey="x" scale="log" domain={domain} allowDataOverflow
          tickFormatter={(v) => `${fmt(Number(v))}円`} tick={axisTick} stroke="var(--border)"
          label={{ value: "1回あたりの費用（対数目盛）", position: "insideBottom", offset: -16, fill: "var(--muted)", fontSize: 12 }}
        />
        <YAxis type="number" dataKey="y" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={axisTick} stroke="var(--border)" />
        <ZAxis range={[90, 90]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3", stroke: "var(--border)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const m = payload[0].payload as ModelStats & { x: number };
            return (
              <TooltipBox
                title={m.label}
                rows={[
                  ["正答率", pct(m.accuracy)],
                  ["1回あたり", `${fmt(m.x)}円`],
                  ["正解1件あたり", m.costPerCorrectUsd === null ? "—" : `${fmt(m.costPerCorrectUsd * usdJpy)}円`],
                ]}
              />
            );
          }}
        />
        {PROVIDERS.map((p) => (
          <Scatter
            key={p.id}
            name={p.label}
            data={data.filter((d) => d.provider === p.id)}
            fill={color(p.id)}
            stroke="var(--surface)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="label"
              content={(props: unknown) => {
                const p = props as { x: number; y: number; width?: number; value: string };
                const cx = p.x + (p.width ?? 0) / 2;
                return (
                  <text x={cx} y={p.y - 6} textAnchor="middle" fontSize={11} fill="var(--text-2)">
                    {p.value}
                  </text>
                );
              }}
            />
          </Scatter>
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
