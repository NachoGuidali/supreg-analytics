import { useMemo, useState } from "react";
import { Link } from "react-router";

import { clearEventMetadataCache } from "../builder/useEventMetadata";
import { Sparkline } from "../charts/TrendChart";
import { Button, ErrorNote, Field, Modal, PageHeader, Panel, Segmented, Switch, Table } from "../components/ui";
import { api } from "../lib/api";
import { formatExact, formatNumber } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useApp } from "../state/AppContext";
import { useToast } from "../state/Toasts";

const SOURCES = { auto: "Automático", rule: "Sin código", custom: "Propio" };
const relative = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });
function ago(iso) {
  if (!iso) return "Nunca";
  const hours = (new Date(iso) - Date.now()) / 3600000;
  if (Math.abs(hours) < 1) return relative.format(Math.round(hours * 60), "minute");
  if (Math.abs(hours) < 24) return relative.format(Math.round(hours), "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export default function Events() {
  const { site, canEdit } = useApp();
  const toast = useToast();
  const catalog = useAsync((signal) => api.get("events/catalog/", { site_id: site.id, days: 30 }, { signal }), [site.id]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [editing, setEditing] = useState(null);

  const events = catalog.data?.events || [];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => (source === "all" || e.source === source) && (!q || `${e.event_name} ${e.label} ${e.description}`.toLowerCase().includes(q)));
  }, [events, query, source]);
  const max = Math.max(1, ...events.map((e) => e.count));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Eventos"
        description="Todo lo que llega desde tu web en los últimos 30 días. Poneles un nombre claro y una descripción para que todo el equipo los entienda."
      />
      {catalog.error && <ErrorNote error={catalog.error} />}
      <Panel bodyClassName="">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar evento" aria-label="Buscar evento" className="w-full max-w-64" />
          <Segmented label="Origen" value={source} onChange={setSource}
            options={[{ value: "all", label: "Todos" }, ...Object.entries(SOURCES).map(([value, label]) => ({ value, label }))]} />
        </div>
        <Table
          rows={visible}
          rowKey={(e) => e.event_name}
          empty={catalog.data ? "Ningún evento coincide." : "Cargando…"}
          columns={[
            {
              key: "event_name", label: "Evento",
              render: (e) => (
                <span className={`block max-w-[38ch] ${e.is_hidden ? "opacity-60" : ""}`} title={e.description || undefined}>
                  <span className="block truncate font-medium">{e.label || e.event_name}{e.is_hidden && <span className="ml-2 text-xs font-normal text-muted">oculto</span>}</span>
                  <span className="block truncate text-xs text-muted"><code>{e.event_name}</code></span>
                </span>
              ),
            },
            { key: "source", label: "Origen", className: "hidden xl:table-cell text-ink-2 whitespace-nowrap", render: (e) => SOURCES[e.source] },
            { key: "trend", label: "Tendencia", className: "hidden lg:table-cell", render: (e) => <span className="block w-28"><Sparkline values={e.daily} height={26} /></span> },
            {
              key: "count", label: "Eventos", numeric: true,
              render: (e) => (
                <span className="inline-block min-w-20 text-right" title={formatExact(e.count)}>
                  {formatNumber(e.count)}
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                    <span className="ml-auto block h-full rounded-full bg-[var(--chart-accent)]" style={{ width: `${Math.max(2, (e.count / max) * 100)}%` }} />
                  </span>
                </span>
              ),
            },
            { key: "visitors", label: "Personas", numeric: true, className: "hidden sm:table-cell", render: (e) => formatNumber(e.visitors) },
            { key: "last_seen", label: "Último", className: "hidden 2xl:table-cell whitespace-nowrap text-muted", render: (e) => ago(e.last_seen) },
            {
              key: "actions", label: <span className="sr-only">Acciones</span>, className: "text-right whitespace-nowrap",
              render: (e) => (
                <span className="inline-flex gap-1">
                  <Link to={`/constructor?evento=${encodeURIComponent(e.event_name)}`} className="rounded-lg px-2.5 py-1 text-[13px] text-ink-2 hover:bg-surface-2">Analizar</Link>
                  {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Editar</Button>}
                </span>
              ),
            },
          ]}
        />
      </Panel>

      {editing && (
        <DefinitionDialog
          siteId={site.id}
          event={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            clearEventMetadataCache();
            catalog.reload();
            toast("Evento actualizado");
          }}
        />
      )}
    </div>
  );
}

function DefinitionDialog({ siteId, event, onClose, onSaved }) {
  const [values, setValues] = useState({ label: event.label || "", description: event.description || "", is_hidden: event.is_hidden });
  const [error, setError] = useState(null);
  return (
    <Modal title={<code className="text-lg">{event.event_name}</code>} onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post("event-definitions/", { site_id: siteId, event_name: event.event_name, ...values });
            onSaved();
          } catch (err) {
            setError(err);
          }
        }}
      >
        <Field label="Nombre para mostrar" hint="Aparece en los selectores del constructor junto al nombre técnico.">
          <input autoFocus maxLength={120} value={values.label} onChange={(e) => setValues({ ...values, label: e.target.value })} className="w-full" placeholder="Click en WhatsApp" />
        </Field>
        <Field label="Descripción">
          <textarea rows={3} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} className="w-full"
            placeholder="Qué significa, dónde se dispara y desde cuándo." />
        </Field>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line px-4 py-3">
          <span>
            <span className="block text-sm font-medium">Ocultar de los selectores</span>
            <span className="block text-[13px] text-muted">Se sigue registrando; sólo deja de ofrecerse en el constructor.</span>
          </span>
          <Switch checked={values.is_hidden} onChange={(v) => setValues({ ...values, is_hidden: v })} label="Ocultar de los selectores" />
        </div>
        {error && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
