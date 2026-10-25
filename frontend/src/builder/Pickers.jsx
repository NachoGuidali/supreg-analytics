import { formatNumber } from "../lib/format";
import { fieldLabel } from "./definitions";
import { useEventFields, useEventNames } from "./useEventMetadata";

export function EventSelect({ siteId, value, onChange, id, placeholder = "Elegí un evento" }) {
  const { names, loading, error } = useEventNames(siteId);
  const known = names.some((n) => n.name === value);
  return (
    <select id={id} value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full" aria-invalid={!value}>
      <option value="">{loading ? "Cargando eventos…" : error ? "No se pudieron cargar" : placeholder}</option>
      {value && !known && !loading && <option value={value}>{value} (sin datos recientes)</option>}
      {names.map((n) => (
        <option key={n.name} value={n.name}>
          {n.label ? `${n.label} (${n.name}, ${formatNumber(n.count)})` : `${n.name} (${formatNumber(n.count)})`}
        </option>
      ))}
    </select>
  );
}

const SOURCE_LABELS = { event: "Evento", session: "Sesión", visitor: "Visitante", properties: "Propiedades del evento" };

export function FieldSelect({ siteId, eventName, value, onChange, emptyLabel = "Elegí un campo", id, className = "w-full" }) {
  const { fields } = useEventFields(siteId, eventName);
  const groups = Object.keys(SOURCE_LABELS)
    .map((source) => ({ source, items: fields.filter((f) => f.source === source) }))
    .filter((g) => g.items.length);
  const known = fields.some((f) => f.name === value);

  return (
    <select id={id} value={value || ""} onChange={(e) => onChange(e.target.value, fields.find((f) => f.name === e.target.value))} className={className}>
      <option value="">{emptyLabel}</option>
      {value && !known && <option value={value}>{fieldLabel(value)}</option>}
      {groups.map((group) => (
        <optgroup key={group.source} label={SOURCE_LABELS[group.source]}>
          {group.items.map((field) => (
            <option key={field.name} value={field.name}>
              {fieldLabel(field.name)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
