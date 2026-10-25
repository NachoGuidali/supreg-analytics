import { useState } from "react";

import { useEventNames } from "../builder/useEventMetadata";
import { Delta } from "../charts/MetricTile";
import { Sparkline } from "../charts/TrendChart";
import HelpTip from "../components/HelpTip";
import { PlusIcon } from "../components/icons";
import { Button, EmptyState, ErrorNote, Field, Modal, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { formatExact, formatPercent } from "../lib/format";
import { useReport } from "../lib/hooks";
import { useApp, useDateParams } from "../state/AppContext";
import { useToast } from "../state/Toasts";

// Atajos para el primer objetivo: lo que más mide una pyme.
const SUGGESTIONS = [
  { name: "Contacto por WhatsApp", event_name: "whatsapp_click" },
  { name: "Formulario enviado", event_name: "form_submit" },
  { name: "Descarga de archivos", event_name: "file_download" },
  { name: "Click a otro sitio", event_name: "outbound_click" },
];

export default function Goals() {
  const { site, canEdit } = useApp();
  const dateParams = useDateParams();
  const toast = useToast();
  const stats = useReport("goals/stats/", site.id, dateParams);
  const [editing, setEditing] = useState(null); // null | {} (nuevo) | goal
  const goals = stats.data?.goals || [];

  const remove = async (goal) => {
    if (!window.confirm(`¿Borrar el objetivo «${goal.name}»? Los eventos no se borran.`)) return;
    await api.delete(`goals/${goal.id}/`);
    toast(`Objetivo «${goal.name}» borrado`);
    stats.reload();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Objetivos"
        description="Las acciones que cuentan como conversión, y cuántas visitas terminan en ellas."
        actions={canEdit && goals.length > 0 && <Button variant="primary" onClick={() => setEditing({})}><PlusIcon /> Nuevo objetivo</Button>}
      />
      {stats.error && <ErrorNote error={stats.error} />}

      {stats.data && goals.length === 0 && (
        <EmptyState
          title="Definí qué es una conversión para tu sitio"
          action={canEdit && (
            <div className="flex flex-wrap gap-2 pt-1">
              {SUGGESTIONS.map((s) => <Button key={s.event_name} size="sm" onClick={() => setEditing(s)}>{s.name}</Button>)}
              <Button size="sm" variant="primary" onClick={() => setEditing({})}>Otro evento</Button>
            </div>
          )}
        >
          Un objetivo es un evento que te importa: un click en WhatsApp, un formulario, llegar a la página de gracias.
          Vas a ver cuántas personas lo cumplen, qué porcentaje de las visitas convierte y desde qué canal.
        </EmptyState>
      )}

      {goals.length > 0 && (
        <p className="text-sm text-ink-2">
          Sobre {formatExact(stats.data.visitors)} visitantes únicos en el rango.
        </p>
      )}

      <div className={`grid gap-4 xl:grid-cols-2 ${stats.loading && stats.data ? "opacity-60" : ""}`}>
        {goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} canEdit={canEdit} onEdit={() => setEditing(goal)} onDelete={() => remove(goal)} />
        ))}
      </div>

      {editing && (
        <GoalDialog
          siteId={site.id}
          goal={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            stats.reload();
            toast(created ? `Objetivo «${saved.name}» creado` : "Cambios guardados");
          }}
        />
      )}
    </div>
  );
}

function GoalCard({ goal, canEdit, onEdit, onDelete }) {
  const top = goal.by_channel.slice(0, 4);
  const max = Math.max(1, ...top.map((c) => c.conversions));
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold tracking-tight">{goal.name}</h2>
          <p className="truncate text-[13px] text-muted">
            <code>{goal.event_name}</code>{goal.page_contains && ` en páginas con “${goal.page_contains}”`}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" onClick={onEdit}>Editar</Button>
            <Button size="sm" variant="ghost" onClick={onDelete}>Borrar</Button>
          </div>
        )}
      </header>

      <div className="mt-4 grid grid-cols-[auto_1fr] items-end gap-x-6 gap-y-1">
        <div>
          <p className="text-[13px] text-ink-2">Conversiones</p>
          <p className="figure text-[40px] font-semibold leading-none" title={`${formatExact(goal.events)} eventos en total`}>{formatExact(goal.conversions)}</p>
        </div>
        <div className="min-w-0"><Sparkline values={goal.daily} height={48} /></div>
        <div className="col-span-2 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium tabular">{formatPercent(goal.rate)}</span>
            <span className="text-muted">de los visitantes</span>
            <HelpTip>Tasa de conversión: visitantes únicos que cumplieron el objetivo sobre el total de visitantes del rango.</HelpTip>
          </span>
          <Delta change={goal.change_percent} />
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-[13px] font-medium text-ink-2">Desde qué canal convierten</p>
        {top.length === 0 ? (
          <p className="text-[13px] text-muted">Sin conversiones en el rango.</p>
        ) : (
          <ul className="space-y-1.5">
            {top.map((c) => (
              <li key={c.key} className="grid grid-cols-[120px_1fr_40px] items-center gap-3 text-[13px]">
                <span className="truncate text-ink-2">{c.label}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                  <span className="block h-full rounded-full bg-[var(--chart-accent)]" style={{ width: `${(c.conversions / max) * 100}%` }} />
                </span>
                <span className="text-right tabular">{formatExact(c.conversions)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function GoalDialog({ siteId, goal, onClose, onSaved }) {
  const { names } = useEventNames(siteId);
  const [values, setValues] = useState({ name: goal.name || "", event_name: goal.event_name || "", page_contains: goal.page_contains || "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setValues({ ...values, [key]: e.target.value });
  const editing = Boolean(goal.id);

  return (
    <Modal title={editing ? "Editar objetivo" : "Nuevo objetivo"} onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const body = { ...values, name: values.name.trim(), event_name: values.event_name.trim(), page_contains: values.page_contains.trim() };
            const saved = editing ? await api.patch(`goals/${goal.id}/`, body) : await api.post("goals/", { ...body, site_id: siteId });
            onSaved(saved, !editing);
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        <Field label="Nombre">
          <input autoFocus required maxLength={120} value={values.name} onChange={set("name")} className="w-full" placeholder="Contacto por WhatsApp" />
        </Field>
        <Field label="Evento" hint="Elegí uno que ya llega o escribí el nombre de uno nuevo (por ejemplo, una regla sin código).">
          <input required list="goal-events" value={values.event_name} onChange={set("event_name")} className="w-full font-mono text-[13px]" placeholder="whatsapp_click" />
          <datalist id="goal-events">
            {names.map((n) => <option key={n.name} value={n.name}>{n.label || n.name}</option>)}
          </datalist>
        </Field>
        <Field label="Sólo en páginas que contengan (opcional)" hint="Por ejemplo /productos para contar sólo los clicks hechos en fichas de producto.">
          <input maxLength={300} value={values.page_contains} onChange={set("page_contains")} className="w-full" placeholder="/productos" />
        </Field>
        {error && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>{editing ? "Guardar cambios" : "Crear objetivo"}</Button>
        </div>
      </form>
    </Modal>
  );
}
