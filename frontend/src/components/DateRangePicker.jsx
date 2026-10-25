import { useEffect, useRef, useState } from "react";

import { PRESETS, rangeLabel } from "../lib/dates";
import { useApp } from "../state/AppContext";
import { Button } from "./ui";

export default function DateRangePicker() {
  const { range, setRange, dates } = useApp();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(dates);
  const ref = useRef();

  useEffect(() => {
    if (!open) return undefined;
    setCustom(dates);
    const close = (event) => !ref.current.contains(event.target) && setOpen(false);
    const escape = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (next) => {
    setRange(next);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <CalendarIcon />
        <span>{rangeLabel(range, dates)}</span>
        <span className="hidden text-muted tabular sm:inline">
          {dates.from === dates.to ? dates.from : `${dates.from} – ${dates.to}`}
        </span>
      </Button>
      {open && (
        <div role="dialog" aria-label="Rango de fechas" className="absolute left-0 z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => choose({ preset: preset.id })}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              {preset.label}
              {range.preset === preset.id && <CheckIcon />}
            </button>
          ))}
          <form
            className="mt-1 border-t border-line px-3 pb-2 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.from && custom.to && custom.from <= custom.to) choose({ preset: "custom", ...custom });
            }}
          >
            <p className="mb-2 text-[13px] font-medium text-ink-2">Personalizado</p>
            <div className="flex items-center gap-2">
              <input type="date" aria-label="Desde" value={custom.from} max={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="w-full text-sm" />
              <input type="date" aria-label="Hasta" value={custom.to} min={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="w-full text-sm" />
            </div>
            <Button type="submit" variant="primary" size="sm" className="mt-2 w-full justify-center">
              Aplicar rango
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-label="seleccionado">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
