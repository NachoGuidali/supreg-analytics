import { useState } from "react";

import { formatDay, formatExact, formatPercent } from "../lib/format";
import { inkOn, useChartColors } from "./chartKit";

const PERIOD_NAME = { day: "Día", week: "Semana" };

function stepFor(percent) {
  if (percent === 0) return 0;
  return Math.min(7, 1 + Math.floor((percent / 100) * 7));
}

export default function RetentionHeatmap({ data }) {
  const colors = useChartColors();
  const [hover, setHover] = useState(null);
  const offsets = Array.from({ length: data.periods_count + 1 }, (_, i) => i);
  const periodName = PERIOD_NAME[data.period] || data.period;

  const cell = (value, key) => {
    if (!value) return <td key={key} className="border border-surface bg-transparent" aria-label="sin datos" />;
    const background = colors[`seq-${stepFor(value.percent)}`];
    return (
      <td
        key={key}
        tabIndex={0}
        onPointerEnter={() => setHover({ key, value })}
        onFocus={() => setHover({ key, value })}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        title={`${formatExact(value.count)} visitantes`}
        className="h-8 min-w-12 border-2 border-surface px-1.5 text-right text-xs tabular outline-offset-[-2px]"
        style={{ background, color: inkOn(background) }}
      >
        {formatPercent(value.percent)}
      </td>
    );
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="border-collapse text-[13px]">
          <caption className="sr-only">Retención por cohorte</caption>
          <thead>
            <tr className="text-ink-2">
              <th scope="col" className="px-2 py-1.5 text-left font-medium">Cohorte</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Visitantes</th>
              {offsets.map((o) => (
                <th key={o} scope="col" className="px-1.5 py-1.5 text-right font-medium whitespace-nowrap">
                  {periodName} {o}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <th scope="row" className="px-2 py-1.5 text-left font-medium">Promedio</th>
              <td className="px-2 text-right text-muted">—</td>
              {data.average.map((value, o) =>
                value === null ? (
                  <td key={o} />
                ) : (
                  <td key={o} className="px-1.5 text-right text-xs font-semibold tabular">{formatPercent(value)}</td>
                )
              )}
            </tr>
            {data.cohorts.map((cohort) => (
              <tr key={cohort.cohort}>
                <th scope="row" className="px-2 py-0.5 text-left font-normal whitespace-nowrap text-ink-2">
                  {formatDay(cohort.cohort, data.period)}
                </th>
                <td className="px-2 text-right tabular">{formatExact(cohort.size)}</td>
                {cohort.values.map((value, o) => cell(value, `${cohort.cohort}-${o}`))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="min-h-5 text-[13px] text-ink-2" aria-live="polite">
        {hover
          ? `${formatExact(hover.value.count)} visitantes volvieron (${formatPercent(hover.value.percent)} de la cohorte)`
          : "Porcentaje de cada cohorte que volvió a hacer el evento en cada período. Las celdas vacías todavía no ocurrieron."}
      </p>
    </div>
  );
}
