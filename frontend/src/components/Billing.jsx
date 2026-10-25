// Estado de la suscripción de un cliente (ver accounts/billing.py). Siempre texto + punto, nunca sólo color.

const dateFormat = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatDate(iso) {
  return iso ? dateFormat.format(new Date(`${iso}T00:00:00Z`)) : "—";
}

export function formatMoney(amount, currency = "ARS") {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

export const PERIODS = { monthly: "por mes", yearly: "por año" };
export const PERIOD_MONTHS = { monthly: 1, yearly: 12 };

export function todayIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}

/** Igual que el backend: suma meses y recorta al último día del mes si hace falta. */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Próximo vencimiento al registrar un pago: desde el actual si sigue vigente, si no desde hoy. */
export function nextPaidUntil(paidUntil, months) {
  const today = todayIso();
  return addMonths(paidUntil && paidUntil >= today ? paidUntil : today, months);
}

export function billingText(billing) {
  const days = billing?.days_left;
  switch (billing?.status) {
    case "ok": return `Al día, vence en ${days} días`;
    case "expiring": return days === 0 ? "Vence hoy" : `Vence en ${days} ${days === 1 ? "día" : "días"}`;
    case "overdue": return `Vencido hace ${-days} ${days === -1 ? "día" : "días"}`;
    case "blocked": return `Bloqueado: vencido hace ${-days} días`;
    default: return "Sin vencimiento";
  }
}

const TONES = {
  ok: { dot: "bg-good", text: "text-ink-2" },
  expiring: { dot: "bg-status-warning", text: "text-status-warning" },
  overdue: { dot: "bg-bad", text: "text-bad" },
  blocked: { dot: "bg-bad", text: "text-bad" },
  none: { dot: "bg-line", text: "text-muted" },
};

export function BillingPill({ billing, short = false }) {
  const tone = TONES[billing?.status] || TONES.none;
  const label = short
    ? { ok: "Al día", expiring: billing.days_left === 0 ? "Vence hoy" : `Vence en ${billing.days_left} d`, overdue: "Vencido", blocked: "Bloqueado", none: "Sin vencimiento" }[billing?.status || "none"]
    : billingText(billing);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] ${tone.text}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {label}
    </span>
  );
}

export const needsAttention = (billing) => ["expiring", "overdue", "blocked"].includes(billing?.status);
