const integer = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

export function formatNumber(value) {
  if (value === null || value === undefined) return "—";
  return Math.abs(value) >= 10000 ? compact.format(value) : integer.format(value);
}

export function formatExact(value) {
  return value === null || value === undefined ? "—" : integer.format(value);
}

export function formatPercent(value) {
  return value === null || value === undefined ? "—" : `${decimal.format(value)}%`;
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min ${total % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const shortDate = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

// Las fechas de la API son YYYY-MM-DD ya en la zona del sitio: se formatean en UTC para no correrlas.
export function formatDay(iso, groupBy = "day") {
  const date = new Date(`${iso}T00:00:00Z`);
  if (groupBy === "month") return monthYear.format(date);
  if (groupBy === "week") return `Sem. ${shortDate.format(date)}`;
  return shortDate.format(date);
}

export function formatDateTime(iso, timeZone) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone,
  }).format(new Date(iso));
}
