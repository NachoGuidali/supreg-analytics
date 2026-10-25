import { useState } from "react";

import { formatExact } from "../lib/format";
import { DataTable, inkOn, useChartColors } from "./chartKit";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** Sesiones por día de la semana y hora (zona del sitio). Rampa secuencial de un tono. */
export default function HourHeatmap({ grid, table = false }) {
  const colors = useChartColors();
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...grid.flat());
  const step = (value) => (value === 0 ? 0 : Math.min(7, 1 + Math.floor((value / max) * 6.99)));

  if (table) {
    return (
      <DataTable
        caption="Sesiones por día y hora"
        columns={[{ key: "day", label: "Día" }, ...Array.from({ length: 24 }, (_, h) => ({ key: `h${h}`, label: `${h} h`, numeric: true, format: formatExact }))]}
        rows={grid.map((row, d) => ({ day: DAYS[d], ...Object.fromEntries(row.map((v, h) => [`h${h}`, v])) }))}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] grid-cols-[40px_repeat(24,minmax(0,1fr))] gap-[3px]" role="grid" aria-label="Sesiones por día y hora">
          {grid.map((row, d) => (
            <div key={d} role="row" className="contents">
              <div role="rowheader" className="pr-2 text-right text-xs leading-6 text-muted">{SHORT[d]}</div>
              {row.map((value, h) => {
                const background = colors[`seq-${step(value)}`];
                const active = hover && hover.d === d && hover.h === h;
                return (
                  <div
                    key={h}
                    role="gridcell"
                    tabIndex={0}
                    aria-label={`${DAYS[d]} de ${h} a ${h + 1} h: ${formatExact(value)} sesiones`}
                    onPointerEnter={() => setHover({ d, h, value })}
                    onFocus={() => setHover({ d, h, value })}
                    onPointerLeave={() => setHover(null)}
                    onBlur={() => setHover(null)}
                    className={`h-6 rounded-[4px] outline-offset-1 transition-transform ${active ? "scale-110 ring-2 ring-ink/70" : ""}`}
                    style={{ background, color: inkOn(background) }}
                  />
                );
              })}
            </div>
          ))}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="pt-1 text-center text-[11px] tabular text-muted">{h % 3 === 0 ? h : ""}</div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-h-5 text-[13px] text-ink-2" aria-live="polite">
          {hover ? `${DAYS[hover.d]} de ${hover.h} a ${hover.h + 1} h: ${formatExact(hover.value)} sesiones` : "Pasá el mouse por una celda para ver el detalle."}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-muted" aria-hidden="true">
          Menos
          {Array.from({ length: 8 }, (_, i) => <span key={i} className="h-3 w-3 rounded-[3px]" style={{ background: colors[`seq-${i}`] }} />)}
          Más
        </div>
      </div>
    </div>
  );
}
