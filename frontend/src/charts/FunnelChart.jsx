import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatExact, formatNumber, formatPercent } from "../lib/format";
import { DataTable, Legend, TooltipCard, axisProps, useChartColors } from "./chartKit";

export default function FunnelChart({ data, height = 300, table = false }) {
  const colors = useChartColors();
  const first = data.steps[0]?.count || 0;
  const rows = data.steps.map((step) => ({
    ...step,
    name: `${step.index + 1}. ${step.event_name}`,
    lost: first - step.count,
  }));

  if (table) {
    return (
      <DataTable
        caption="Embudo"
        columns={[
          { key: "name", label: "Paso" },
          { key: "count", label: "Visitantes", numeric: true, format: formatExact },
          { key: "conversion_from_previous", label: "Desde el paso anterior", numeric: true, format: formatPercent },
          { key: "conversion_from_start", label: "Desde el inicio", numeric: true, format: formatPercent },
          { key: "drop_off", label: "Abandonan", numeric: true, format: formatExact },
        ]}
        rows={rows}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-ink-2">
          Conversión total <span className="ml-1 text-3xl font-semibold tracking-tight text-ink">{formatPercent(data.overall_conversion)}</span>
        </p>
        <Legend
          kind="rect"
          items={[
            { key: "c", label: "Llegan al paso", color: colors["chart-accent"] },
            { key: "l", label: "Quedaron en el camino", color: colors.grid },
          ]}
        />
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={colors.grid} />
            <XAxis dataKey="name" {...axisProps(colors)} interval={0} tickFormatter={(v) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)} />
            <YAxis {...axisProps(colors)} axisLine={false} allowDecimals={false} width={44} tickFormatter={formatNumber} />
            <Tooltip
              cursor={{ fill: colors["surface-2"], opacity: 0.5 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const step = payload[0].payload;
                return (
                  <TooltipCard
                    title={step.name}
                    rows={[
                      { key: "c", label: "visitantes", value: formatExact(step.count), color: colors["chart-accent"] },
                      { key: "p", label: "desde el paso anterior", value: formatPercent(step.conversion_from_previous) },
                      { key: "s", label: "desde el inicio", value: formatPercent(step.conversion_from_start) },
                    ]}
                  />
                );
              }}
            />
            {/* 2px de separación entre segmentos apilados, del color de la superficie. */}
            <Bar dataKey="count" stackId="f" fill={colors["chart-accent"]} maxBarSize={56} stroke={colors.surface} strokeWidth={2} isAnimationActive={false}>
              <LabelList
                dataKey="conversion_from_start"
                position="top"
                formatter={formatPercent}
                style={{ fill: colors["ink-2"], fontSize: 12 }}
              />
            </Bar>
            <Bar dataKey="lost" stackId="f" fill={colors.grid} maxBarSize={56} radius={[4, 4, 0, 0]} stroke={colors.surface} strokeWidth={2} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
