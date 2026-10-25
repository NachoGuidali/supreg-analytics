import { Button, Field, Segmented } from "../components/ui";
import { MEASURES, PERIODS } from "./definitions";
import FilterBuilder from "./FilterBuilder";
import { EventSelect, FieldSelect } from "./Pickers";

function Section({ title, children }) {
  return (
    <fieldset className="space-y-2 border-t border-line pt-4">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden="true" className="text-[13px] font-semibold text-ink-2">{title}</p>
      {children}
    </fieldset>
  );
}

export default function ConfigForm({ type, config, onChange, siteId }) {
  const set = (patch) => onChange({ ...config, ...patch });
  const Form = { trend: TrendForm, funnel: FunnelForm, retention: RetentionForm, breakdown: BreakdownForm, metric: MetricForm }[type];
  return <Form config={config} set={set} siteId={siteId} />;
}

function Filters({ siteId, eventName, config, set, title = "Filtros" }) {
  return (
    <Section title={title}>
      <FilterBuilder siteId={siteId} eventName={eventName} filters={config.filters} onChange={(filters) => set({ filters })} />
    </Section>
  );
}

function TrendForm({ config, set, siteId }) {
  return (
    <div className="space-y-4">
      <Field label="Evento">
        <EventSelect siteId={siteId} value={config.event_name} onChange={(event_name) => set({ event_name })} />
      </Field>
      <Field label="Medir">
        <Segmented label="Medida" options={MEASURES} value={config.measure} onChange={(measure) => set({ measure })} />
      </Field>
      <Field label="Agrupar por">
        <Segmented label="Agrupación" options={PERIODS} value={config.group_by} onChange={(group_by) => set({ group_by })} />
      </Field>
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <Field label="Separar por">
          <FieldSelect
            siteId={siteId}
            eventName={config.event_name}
            value={config.breakdown_by}
            onChange={(breakdown_by) => set({ breakdown_by })}
            emptyLabel="Sin separar"
          />
        </Field>
        {config.breakdown_by && (
          <Field label="Series">
            {/* Máximo 8: más colores ya no se distinguen. */}
            <select value={config.breakdown_limit} onChange={(e) => set({ breakdown_limit: Number(e.target.value) })} className="w-full">
              {[3, 5, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Filters siteId={siteId} eventName={config.event_name} config={config} set={set} />
    </div>
  );
}

function BreakdownForm({ config, set, siteId }) {
  return (
    <div className="space-y-4">
      <Field label="Evento">
        <EventSelect siteId={siteId} value={config.event_name} onChange={(event_name) => set({ event_name })} />
      </Field>
      <Field label="Agrupar por">
        <FieldSelect siteId={siteId} eventName={config.event_name} value={config.breakdown_by} onChange={(breakdown_by) => set({ breakdown_by })} />
      </Field>
      <Field label="Medir">
        <Segmented label="Medida" options={MEASURES} value={config.measure} onChange={(measure) => set({ measure })} />
      </Field>
      <Field label="Cantidad de valores">
        <select value={config.limit} onChange={(e) => set({ limit: Number(e.target.value) })} className="w-28">
          {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </Field>
      <Filters siteId={siteId} eventName={config.event_name} config={config} set={set} />
    </div>
  );
}

function MetricForm({ config, set, siteId }) {
  return (
    <div className="space-y-4">
      <Field label="Evento">
        <EventSelect siteId={siteId} value={config.event_name} onChange={(event_name) => set({ event_name })} />
      </Field>
      <Field label="Medir">
        <Segmented label="Medida" options={MEASURES} value={config.measure} onChange={(measure) => set({ measure })} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.compare_to_previous_period}
          onChange={(e) => set({ compare_to_previous_period: e.target.checked })}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Comparar con el período anterior
      </label>
      <Filters siteId={siteId} eventName={config.event_name} config={config} set={set} />
    </div>
  );
}

const WINDOWS = [
  { value: 1, label: "1 hora" },
  { value: 24, label: "1 día" },
  { value: 168, label: "7 días" },
  { value: 720, label: "30 días" },
];

function FunnelForm({ config, set, siteId }) {
  const steps = config.steps;
  const setStep = (index, patch) => set({ steps: steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const move = (index, delta) => {
    const next = [...steps];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    set({ steps: next });
  };

  return (
    <div className="space-y-4">
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={index} className="rounded-xl border border-line p-3">
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center text-[13px] font-semibold text-ink-2">{index + 1}</span>
              <EventSelect siteId={siteId} value={step.event_name} onChange={(event_name) => setStep(index, { event_name })} />
              <div className="flex shrink-0">
                <IconButton label="Subir paso" disabled={index === 0} onClick={() => move(index, -1)}>↑</IconButton>
                <IconButton label="Bajar paso" disabled={index === steps.length - 1} onClick={() => move(index, 1)}>↓</IconButton>
                <IconButton label="Quitar paso" disabled={steps.length <= 2} onClick={() => set({ steps: steps.filter((_, i) => i !== index) })}>✕</IconButton>
              </div>
            </div>
            <details className="mt-2 pl-7" open={step.filters?.length > 0}>
              <summary className="cursor-pointer text-[13px] text-ink-2">
                Filtros de este paso{step.filters?.length ? ` (${step.filters.length})` : ""}
              </summary>
              <div className="mt-2">
                <FilterBuilder
                  siteId={siteId}
                  eventName={step.event_name}
                  filters={step.filters}
                  onChange={(filters) => setStep(index, { filters })}
                  emptyText="Cualquier ocurrencia del evento cuenta."
                />
              </div>
            </details>
          </li>
        ))}
      </ol>
      <Button size="sm" onClick={() => set({ steps: [...steps, { event_name: "", filters: [] }] })} disabled={steps.length >= 10}>
        + Agregar paso
      </Button>
      <Field label="Ventana de conversión" hint="Tiempo máximo desde el primer paso hasta el último.">
        <Segmented label="Ventana" options={WINDOWS} value={config.conversion_window_hours} onChange={(v) => set({ conversion_window_hours: v })} />
      </Field>
      <Filters siteId={siteId} eventName={steps[0]?.event_name} config={config} set={set} title="Filtros para todos los pasos" />
    </div>
  );
}

function RetentionForm({ config, set, siteId }) {
  return (
    <div className="space-y-4">
      <Field label="Evento inicial" hint="La cohorte es el período en que cada visitante lo hizo por primera vez.">
        <EventSelect siteId={siteId} value={config.start_event} onChange={(start_event) => set({ start_event })} />
      </Field>
      <Field label="Evento de retorno">
        <EventSelect siteId={siteId} value={config.return_event} onChange={(return_event) => set({ return_event })} />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Período">
          <Segmented label="Período" options={PERIODS.slice(0, 2)} value={config.period} onChange={(period) => set({ period })} />
        </Field>
        <Field label="Cantidad de períodos">
          <input
            type="number"
            min={1}
            max={90}
            value={config.periods_count}
            onChange={(e) => set({ periods_count: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })}
            className="w-24"
          />
        </Field>
      </div>
      <Filters siteId={siteId} eventName={config.start_event} config={config} set={set} />
    </div>
  );
}

function IconButton({ label, children, ...props }) {
  return (
    <button type="button" aria-label={label} title={label}
      className="rounded px-1.5 py-1 text-sm text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent" {...props}>
      {children}
    </button>
  );
}
