"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axisTick = { fill: "var(--text-2)", fontSize: 12 };

// 登録・利用の累計（訪問の累計はツールチップで見られる）
export function SignupTrend({ data }: { data: { day: string; visits: number; signups: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="day" tick={axisTick} stroke="var(--border)" tickLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} tick={axisTick} stroke="var(--border)" tickLine={false} axisLine={false} width={36} />
        <Tooltip
          cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as { day: string; visits: number; signups: number };
            return (
              <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                <div className="mb-1 font-medium text-ink">{d.day} までの累計</div>
                <div className="num flex justify-between gap-4 text-ink-2"><span>登録・利用</span><span className="text-ink">{d.signups}人</span></div>
                <div className="num flex justify-between gap-4 text-ink-2"><span>訪問</span><span className="text-ink">{d.visits}人</span></div>
              </div>
            );
          }}
        />
        <Area type="monotone" dataKey="signups" stroke="var(--accent)" strokeWidth={2} fill="var(--accent)" fillOpacity={0.12} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
