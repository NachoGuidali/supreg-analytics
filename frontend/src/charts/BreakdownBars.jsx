import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatExact, formatNumber, formatPercent } from "../lib/format";
import { DataTable, TooltipCard, displayValue, textWidth, useChartColors } from "./chartKit";

const MEASURE_LABEL = { count: "Eventos", unique_visitors: "Visitantes únicos", unique_sessions: "Sesiones únicas" };

export default function BreakdownBars({ data, table = false, compact = false }) {
  const colors = useChartColors();
  const rows = data.rows.map((row) => ({ ...row, name: displayValue(row.value) }));
  const measureLabel = MEASURE_LABEL[data.measure] || data.measure;

  if (table || !rows.length) {
    return (
      <DataTable
        caption="Ranking"
        columns={[
          { key: "name", label: data.breakdown_by },
          { key: "measure", label: measureLabel, numeric: true, format: formatExact },
          { key: "percent", label: "% del total", numeric: true, format: formatPercent },
        ]}
        rows={rows}
      />
    );
  }

  const rowHeight = compact ? 28 : 34;
  const height = rows.length * rowHeight + 8;
  const shortLabel = (v) => (String(v).length > 26 ? `${String(v).slice(0, 25)}…` : String(v));
  const labelWidth = Math.ceil(Math.min(200, Math.max(56, ...rows.map((r) => textWidth(shortLabel(r.name))))) + 12);
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 0 }} barCategoryGap={2}>
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="name"
              width={labelWidth}
              axisLine={false}
              tickLine={false}
              tick={{ fill: colors["ink-2"], fontSize: 13 }}
              tickFormatter={shortLabel}
            />
            <Tooltip
              cursor={{ fill: colors["surface-2"] }}
              isAnimationActive={false}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipCard
                    title={String(payload[0].payload.name)}
                    rows={[
                      { key: "v", label: measureLabel, value: formatExact(payload[0].payload.measure), color: colors["chart-accent"] },
                      { key: "p", label: "del total", value: formatPercent(payload[0].payload.percent) },
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="measure" maxBarSize={compact ? 14 : 20} radius={[0, 4, 4, 0]} isAnimationActive={false} background={{ fill: colors["surface-2"], radius: 4 }}>
              {rows.map((row) => (
                <Cell key={row.name} fill={colors["chart-accent"]} />
              ))}
              <LabelList
                dataKey="measure"
                position="right"
                formatter={formatNumber}
                style={{ fill: colors["ink-2"], fontSize: 12, fontVariantNumeric: "tabular-nums" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {data.other > 0 && <p className="mt-1 text-[13px] text-muted">Otros valores: {formatExact(data.other)}</p>}
    </div>
  );
}
