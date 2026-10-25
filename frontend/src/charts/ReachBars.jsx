import { formatExact, formatPercent } from "../lib/format";

/**
 * Alcance acumulado (scroll: qué parte de las visitas llegó a cada corte). Barras horizontales
 * del color de la marca sobre un riel; el texto queda siempre en tinta, nunca en el color.
 */
export default function ReachBars({ rows, labelOf, valueLabel = "visitas" }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(64px,auto)_1fr_auto] items-center gap-3 text-sm">
          <span className="text-ink-2">{labelOf(row)}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <span className="block h-full rounded-full bg-[var(--chart-accent)] transition-[width] duration-500" style={{ width: `${Math.max(row.percent, row.percent > 0 ? 1.5 : 0)}%` }} />
          </span>
          <span className="w-28 text-right tabular" title={`${formatExact(row.value)} ${valueLabel}`}>
            <span className="font-medium">{formatPercent(row.percent)}</span>
            <span className="ml-2 text-[13px] text-muted">{formatExact(row.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
