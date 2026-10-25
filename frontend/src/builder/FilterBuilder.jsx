import { useId } from "react";

import { Button } from "../components/ui";
import { OPERATOR_LABELS, VALUELESS_OPERATORS } from "./definitions";
import { FieldSelect } from "./Pickers";
import { useEventFields } from "./useEventMetadata";

const FALLBACK_OPERATORS = ["equals", "not_equals", "contains", "not_contains", "in", "is_set", "is_not_set"];

export default function FilterBuilder({ siteId, eventName, filters = [], onChange, emptyText = "Sin filtros" }) {
  const { fields, operatorsByType } = useEventFields(siteId, eventName);

  const update = (index, patch) => onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const remove = (index) => onChange(filters.filter((_, i) => i !== index));
  const add = () => onChange([...filters, { property: "", operator: "equals", value: "" }]);

  return (
    <div className="space-y-2">
      {filters.length === 0 && <p className="text-[13px] text-muted">{emptyText}</p>}
      {filters.map((filter, index) => {
        const field = fields.find((f) => f.name === filter.property);
        const type = field?.type || "string";
        const operators = operatorsByType[type] || FALLBACK_OPERATORS;
        return (
          <FilterRow
            key={index}
            siteId={siteId}
            eventName={eventName}
            filter={filter}
            field={field}
            type={type}
            operators={operators}
            onChange={(patch) => update(index, patch)}
            onRemove={() => remove(index)}
            onFieldChange={(name, nextField) => {
              const nextOps = operatorsByType[nextField?.type || "string"] || FALLBACK_OPERATORS;
              update(index, {
                property: name,
                operator: nextOps.includes(filter.operator) ? filter.operator : nextOps[0],
                value: "",
              });
            }}
          />
        );
      })}
      <Button size="sm" variant="ghost" onClick={add} className="-ml-2">
        + Agregar filtro
      </Button>
    </div>
  );
}

function FilterRow({ siteId, eventName, filter, field, type, operators, onChange, onRemove, onFieldChange }) {
  const datalistId = useId();
  const operatorOptions = operators.includes(filter.operator) ? operators : [filter.operator, ...operators];

  return (
    <div className="grid grid-cols-[1fr_auto] gap-1.5 rounded-xl border border-line bg-plane p-2.5">
      <div className="grid gap-1.5 sm:grid-cols-2">
        <FieldSelect
          siteId={siteId}
          eventName={eventName}
          value={filter.property}
          onChange={onFieldChange}
          emptyLabel="Campo"
          className="w-full text-sm"
        />
        <select
          aria-label="Operador"
          value={filter.operator}
          onChange={(e) => onChange({ operator: e.target.value, ...(VALUELESS_OPERATORS.includes(e.target.value) ? { value: "" } : {}) })}
          className="w-full text-sm"
        >
          {operatorOptions.map((op) => (
            <option key={op} value={op}>{OPERATOR_LABELS[op] || op}</option>
          ))}
        </select>
        {!VALUELESS_OPERATORS.includes(filter.operator) && (
          <div className="sm:col-span-2">
            <ValueInput filter={filter} type={type} field={field} datalistId={datalistId} onChange={(value) => onChange({ value })} />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Quitar filtro"
        className="self-start rounded px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}

function ValueInput({ filter, type, field, datalistId, onChange }) {
  const suggestions = field?.values || [];

  if (type === "boolean") {
    return (
      <select aria-label="Valor" value={String(filter.value)} onChange={(e) => onChange(e.target.value === "true")} className="w-full text-sm">
        <option value="">Elegí</option>
        <option value="true">verdadero</option>
        <option value="false">falso</option>
      </select>
    );
  }

  if (filter.operator === "in") {
    const text = Array.isArray(filter.value) ? filter.value.join(", ") : filter.value || "";
    return (
      <input
        aria-label="Valores separados por coma"
        placeholder="valor1, valor2"
        defaultValue={text}
        onBlur={(e) => {
          const items = e.target.value.split(",").map((v) => v.trim()).filter(Boolean);
          onChange(items.map((v) => (type === "number" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v)));
        }}
        className="w-full text-sm"
      />
    );
  }

  return (
    <>
      <input
        aria-label="Valor"
        type={type === "number" && ["gt", "gte", "lt", "lte"].includes(filter.operator) ? "number" : "text"}
        list={suggestions.length ? datalistId : undefined}
        placeholder={suggestions.length ? `ej. ${suggestions[0].value}` : "Valor"}
        value={filter.value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(type === "number" && raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw);
        }}
        className="w-full text-sm"
      />
      {suggestions.length > 0 && (
        <datalist id={datalistId}>
          {suggestions.map((s) => (
            <option key={String(s.value)} value={String(s.value)} />
          ))}
        </datalist>
      )}
    </>
  );
}
