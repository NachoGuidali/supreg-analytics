import { formatExact, formatNumber, formatPercent } from "../lib/format";

/** Número grande con variación. upIsGood decide si subir se pinta como bueno o malo. */
export function Delta({ change, upIsGood = true, suffix = "vs período anterior" }) {
  if (change === null || change === undefined) {
    return <span className="text-[13px] text-muted">Sin datos previos</span>;
  }
  const up = change > 0;
  const flat = change === 0;
  // Con una base muy chica el porcentaje pierde sentido (+4.400%): se muestra el multiplicador.
  const text = change >= 500 ? `×${formatNumber(Math.round(1 + change / 100))}` : `${up ? "+" : ""}${formatPercent(change)}`;
  const good = flat ? null : up === upIsGood;
  const color = good === null ? "text-muted" : good ? "text-good" : "text-bad";
  return (
    <span className="text-[13px]">
      <span className={`font-medium ${color}`}>
        <span aria-hidden="true">{flat ? "=" : up ? "▲" : "▼"}</span> {text}
      </span>{" "}
      <span className="text-muted">{suffix}</span>
    </span>
  );
}

export default function MetricTile({ label, value, format = formatNumber, change, upIsGood, hero = false, previous }) {
  return (
    <div>
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className={`figure mt-1 font-semibold leading-none ${hero ? "text-5xl" : "text-[28px]"}`} title={formatExact(value)}>
        {format(value)}
      </p>
      <div className="mt-2 min-h-5">
        {change !== undefined && !(change === null && previous !== undefined) && <Delta change={change} upIsGood={upIsGood} />}
        {previous !== undefined && previous !== null && (
          <p className="text-[13px] text-muted">Antes: {format(previous)}</p>
        )}
      </div>
    </div>
  );
}
