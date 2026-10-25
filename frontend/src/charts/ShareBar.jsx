import { formatExact, formatPercent } from "../lib/format";
import { seriesColors, useChartColors } from "./chartKit";

/**
 * Partes de un todo en una sola barra (dispositivos, nuevos vs recurrentes).
 * Colores por entidad; leyenda con valor y porcentaje, así la identidad no depende sólo del color.
 */
export default function ShareBar({ items, valueLabel = "sesiones" }) {
  const colors = useChartColors();
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const colorOf = seriesColors(items.map((i) => i.key), colors);
  if (!total) return <p className="text-sm text-muted">Sin datos en el rango.</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img"
        aria-label={items.map((i) => `${i.label}: ${formatPercent((i.value * 100) / total)}`).join(", ")}>
        {items.filter((i) => i.value > 0).map((item) => (
          <span key={item.key} title={`${item.label}: ${formatExact(item.value)} ${valueLabel}`}
            className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(item.value * 100) / total}%`, background: colorOf[item.key] }} />
        ))}
      </div>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorOf[item.key] }} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{item.label}</span>
            <span className="tabular font-medium">{formatPercent((item.value * 100) / total)}</span>
            <span className="w-14 text-right tabular text-[13px] text-muted">{formatExact(item.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

