import { useCssVars } from "../lib/hooks";

export const SERIES = ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-7", "series-8"];
const CHROME = ["grid", "axis", "muted", "ink", "ink-2", "surface", "surface-2", "line", "chart-accent"];
const SEQUENTIAL = ["seq-0", "seq-1", "seq-2", "seq-3", "seq-4", "seq-5", "seq-6", "seq-7"];

export function useChartColors() {
  return useCssVars([...SERIES, ...CHROME, ...SEQUENTIAL]);
}

export function displayValue(value) {
  return value === "(none)" ? "(sin valor)" : value;
}

/**
 * Color por entidad, no por ranking: se asigna por orden alfabético de las claves,
 * así un cambio de rango que reordena el top no repinta las series.
 */
export function seriesColors(keys, colors) {
  const sorted = [...keys].sort((a, b) => String(a).localeCompare(String(b)));
  return Object.fromEntries(keys.map((key) => [key, colors[SERIES[sorted.indexOf(key) % SERIES.length]]]));
}

export const axisProps = (colors) => ({
  stroke: colors.axis,
  tick: { fill: colors.muted, fontSize: 12 },
  tickLine: false,
});

export function Legend({ items, kind = "line" }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          {kind === "line" ? (
            <span aria-hidden="true" className="inline-block h-0.5 w-3.5 rounded" style={{ background: item.color }} />
          ) : (
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Tooltip: el valor manda, el nombre de la serie acompaña; clave de línea, no caja. */
export function TooltipCard({ title, rows }) {
  return (
    <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] shadow-lg">
      {title && <p className="mb-1 text-muted">{title}</p>}
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            {row.color && <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded" style={{ background: row.color }} />}
            <span className="font-semibold text-ink tabular">{row.value}</span>
            <span className="truncate text-ink-2">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DataTable({ columns, rows, caption }) {
  return (
    <div className="max-h-96 overflow-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 bg-surface-2">
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={`px-3 py-2 font-medium text-ink-2 ${col.numeric ? "text-right" : "text-left"}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-line">
              {columns.map((col) => (
                <td key={col.key} className={`px-3 py-1.5 ${col.numeric ? "text-right tabular" : ""}`}>
                  {col.format ? col.format(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

let measureContext;
/** Ancho real del texto con la tipografía de la app (para dimensionar ejes de categorías). */
export function textWidth(text, font = '13px "Instrument Sans Variable", system-ui, sans-serif') {
  measureContext ??= document.createElement("canvas").getContext("2d");
  measureContext.font = font;
  return measureContext.measureText(String(text)).width;
}

/** Blanco o tinta según la luminancia del fondo, para texto dentro de una celda coloreada. */
export function inkOn(hex) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "inherit";
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.36 ? "#0b0b0b" : "#ffffff";
}
