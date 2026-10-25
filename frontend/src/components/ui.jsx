import { useEffect, useRef, useState } from "react";

export function Button({ variant = "secondary", size = "md", className = "", ...props }) {
  const variants = {
    primary: "bg-accent-fill text-accent-fill-ink hover:bg-accent-fill-hover border-transparent",
    secondary: "bg-surface text-ink hover:bg-surface-2 border-line",
    ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink border-transparent",
    danger: "bg-surface text-bad hover:bg-surface-2 border-line",
  };
  const sizes = { sm: "px-2.5 py-1 text-[13px]", md: "px-3.5 py-2 text-sm" };
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

export function Panel({ title, description, actions, children, className = "", bodyClassName = "px-5 pb-5 pt-3" }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface shadow-card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-1">
          <div className="min-w-0">
            {/* Un título con ayuda (?) no se recorta: el popover quedaría cortado. */}
            {title && <h2 className={`text-[15px] font-semibold ${typeof title === "string" ? "truncate" : ""}`}>{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-[13px] font-medium ${
            value === option.value ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line)]" : "text-ink-2 hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ error, children }) {
  if (!error && !children) return null;
  return (
    <div role="alert" className="rounded-lg border border-line bg-warn-wash px-3 py-2 text-sm text-ink">
      {children || error.message}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line bg-surface/60 px-6 py-8">
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-prose text-sm text-ink-2">{children}</div>}
      {action}
    </div>
  );
}

export function CopyButton({ text, label = "Copiar" }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copiado" : label}
    </Button>
  );
}

export function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto ${wide ? "w-[min(560px,calc(100vw-32px))]" : "w-[min(440px,calc(100vw-32px))]"} rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm`}
    >
      <h2 className="px-6 pt-6 text-xl font-semibold tracking-tight">{title}</h2>
      <div className="px-6 pb-6 pt-4">{children}</div>
    </dialog>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export const ROLES = {
  owner: { label: "Dueño", help: "Gestiona los sitios y el equipo. También puede todo lo del editor." },
  editor: { label: "Editor", help: "Arma análisis, dashboards y objetivos, y configura qué datos se capturan." },
  viewer: { label: "Lector", help: "Ve todos los reportes, dashboards y eventos en vivo. Puede explorar sin guardar." },
};

export function RoleBadge({ role, onDark = false }) {
  if (!role) return null;
  const tone = role === "owner"
    ? onDark ? "bg-accent-on-dark/15 text-accent-on-dark" : "bg-accent-wash text-accent"
    : onDark ? "bg-white/[0.06] text-rail-muted" : "bg-surface-2 text-ink-2";
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{ROLES[role]?.label || role}</span>;
}

export function StatusPill({ active }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] ${active ? "text-ink-2" : "text-bad"}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? "bg-good" : "bg-bad"}`} />
      {active ? "Activo" : "Suspendido"}
    </span>
  );
}

/** Iniciales sobre un círculo; el tono sale del texto para que cada persona tenga siempre el mismo. */
export function Initials({ text, size = 32 }) {
  const clean = (text || "?").replace(/@.*/, "");
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  const letters = ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
  const hue = [...clean].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      aria-hidden="true"
      className="initials inline-grid shrink-0 place-items-center rounded-full font-display text-[12px] font-semibold"
      style={{ width: size, height: size, "--h": hue }}
    >
      {letters}
    </span>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-5 border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={`-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors ${
            value === tab.value ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 tabular text-muted">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Tabla de datos: encabezados discretos, filas separadas por una línea, números alineados a la derecha. */
export function Table({ columns, rows, rowKey, onRowClick, highlight, empty, rowClassName }) {
  if (!rows.length && empty) return <div className="px-5 py-8 text-sm text-muted">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[13px] text-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`whitespace-nowrap px-5 py-2.5 font-medium ${c.numeric ? "text-right" : ""} ${c.className || ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-line last:border-0 ${onRowClick ? "cursor-pointer hover:bg-surface-2/60" : ""} ${highlight === key ? "animate-row-added" : ""} ${rowClassName ? rowClassName(row) : ""}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-5 py-3 align-middle ${c.numeric ? "text-right tabular" : ""} ${c.className || ""}`}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePassword(length = 14) {
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (v) => PASSWORD_ALPHABET[v % PASSWORD_ALPHABET.length]).join("");
}

/** Contraseña inicial para otra persona: visible, con botón para generar una segura. */
export function InitialPasswordInput({ value, onChange, required }) {
  return (
    <div className="flex gap-2">
      <input
        required={required}
        minLength={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="new-password"
        spellCheck={false}
        className="min-w-0 flex-1 font-mono text-[13px]"
      />
      <Button onClick={() => onChange(generatePassword())}>Generar</Button>
    </div>
  );
}

/** Número con una barra fina proporcional, para columnas de tablas de ranking. */
export function BarCell({ value, max, format = (v) => v, children }) {
  const width = max ? Math.max(2, (value / max) * 100) : 0;
  return (
    <span className="block min-w-24">
      <span className="tabular">{children ?? format(value)}</span>
      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <span className="block h-full rounded-full bg-[var(--chart-accent)]" style={{ width: `${width}%` }} />
      </span>
    </span>
  );
}

/** Tarjeta de KPI compacta para reportes: etiqueta, cifra, variación opcional y ayuda. */
export function StatTile({ label, value, help, children }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <p className="flex items-center gap-1.5 text-sm font-medium text-ink-2">{label}{help}</p>
      <p className="figure mt-1 text-[28px] font-semibold leading-tight">{value}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

/** Interruptor accesible (role=switch). La animación del punto confirma el cambio. */
export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "border-transparent bg-accent-fill" : "border-line bg-surface-2"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-[18px] w-[18px] rounded-full shadow transition-transform duration-200 ${
          checked ? "translate-x-[22px] bg-accent-fill-ink" : "translate-x-[3px] bg-surface"
        }`}
      />
    </button>
  );
}
