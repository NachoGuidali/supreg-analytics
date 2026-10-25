import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatDay, formatExact, formatNumber } from "../lib/format";
import { DataTable, Legend, TooltipCard, axisProps, displayValue, seriesColors, useChartColors } from "./chartKit";

// useId de React incluye caracteres que rompen `url(#id)` en SVG.
function useSvgId() {
  return `g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

export default function TrendChart({ data, height = 280, table = false }) {
  const colors = useChartColors();
  const gradientId = useSvgId();
  const { labels, group_by: groupBy } = data;
  const series = data.series.map((s) => ({ ...s, label: displayValue(s.label) }));
  const multi = series.length > 1;
  // Una serie: color de la marca. Varias: paleta categórica validada.
  const colorOf = multi ? seriesColors(series.map((s) => s.key), colors) : { [series[0]?.key]: colors["chart-accent"] };
  const rows = labels.map((label, i) => Object.assign({ label }, ...series.map((s, j) => ({ [`s${j}`]: s.data[i] }))));

  if (table) {
    return (
      <DataTable
        caption="Serie temporal"
        columns={[
          { key: "label", label: "Período", format: (v) => formatDay(v, groupBy) },
          ...series.map((s, j) => ({ key: `s${j}`, label: s.label, numeric: true, format: formatExact })),
        ]}
        rows={rows}
      />
    );
  }

  const Chart = multi ? LineChart : AreaChart;
  const tooltip = (
    <Tooltip
      cursor={{ stroke: colors.axis, strokeWidth: 1 }}
      isAnimationActive={false}
      content={({ active, label, payload }) =>
        active && payload?.length ? (
          <TooltipCard
            title={formatDay(label, groupBy)}
            rows={series.map((s, j) => ({
              key: s.key, label: s.label, color: colorOf[s.key], value: formatExact(payload[0].payload[`s${j}`]),
            }))}
          />
        ) : null
      }
    />
  );
  const dot = (key) => (rows.length === 1 ? { r: 4, fill: colorOf[key], stroke: colors.surface, strokeWidth: 2 } : false);
  const activeDot = (key) => ({ r: 5, fill: colorOf[key], stroke: colors.surface, strokeWidth: 2 });

  return (
    <div className="space-y-3">
      {multi && <Legend items={series.map((s) => ({ key: s.key, label: s.label, color: colorOf[s.key] }))} />}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors["chart-accent"]} stopOpacity={0.22} />
                <stop offset="100%" stopColor={colors["chart-accent"]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={colors.grid} />
            <XAxis dataKey="label" {...axisProps(colors)} tickFormatter={(v) => formatDay(v, groupBy)} minTickGap={28} />
            <YAxis {...axisProps(colors)} axisLine={false} allowDecimals={false} width={44} tickFormatter={formatNumber} />
            {tooltip}
            {multi
              ? series.map((s, j) => (
                  <Line key={s.key} dataKey={`s${j}`} name={s.label} type="monotone" stroke={colorOf[s.key]} strokeWidth={2}
                    strokeLinejoin="round" strokeLinecap="round" dot={dot(s.key)} activeDot={activeDot(s.key)} isAnimationActive={false} />
                ))
              : (
                <Area dataKey="s0" name={series[0].label} type="monotone" stroke={colorOf[series[0].key]} strokeWidth={2}
                  fill={`url(#${gradientId})`} dot={dot(series[0].key)} activeDot={activeDot(series[0].key)} isAnimationActive={false} />
              )}
          </Chart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Mini gráfico para tarjetas: sin ejes, sólo la forma de la serie. */
export function Sparkline({ values, height = 44 }) {
  const colors = useChartColors();
  const gradientId = useSvgId();
  if (!values?.length) return <div style={{ height }} />;
  const rows = values.map((value, i) => ({ i, value }));
  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 4, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors["chart-accent"]} stopOpacity={0.25} />
              <stop offset="100%" stopColor={colors["chart-accent"]} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area dataKey="value" type="monotone" stroke={colors["chart-accent"]} strokeWidth={1.75} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
