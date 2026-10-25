// Fechas como strings YYYY-MM-DD, calculadas en la zona horaria del sitio.

export function todayIn(timeZone) {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

export function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const PRESETS = [
  { id: "today", label: "Hoy" },
  { id: "7d", label: "Últimos 7 días" },
  { id: "30d", label: "Últimos 30 días" },
  { id: "90d", label: "Últimos 90 días" },
  { id: "month", label: "Este mes" },
];

export function resolveRange(range, timeZone) {
  const today = todayIn(timeZone);
  switch (range.preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "custom":
      return { from: range.from, to: range.to };
    default:
      return { from: addDays(today, -29), to: today };
  }
}

export function rangeLabel(range, resolved) {
  const preset = PRESETS.find((p) => p.id === range.preset);
  return preset ? preset.label : `${resolved.from} → ${resolved.to}`;
}
