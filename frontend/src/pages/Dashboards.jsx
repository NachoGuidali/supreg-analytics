import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import AnalysisCard from "../components/AnalysisCard";
import { FunnelIcon, NumberIcon, PlusIcon, RankingIcon, RetentionIcon, TrendIcon } from "../components/icons";
import { Button, EmptyState, ErrorNote, Field, Modal, PageHeader, Segmented } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useApp } from "../state/AppContext";
import { useToast } from "../state/Toasts";

const TYPE_ICONS = { trend: TrendIcon, funnel: FunnelIcon, retention: RetentionIcon, breakdown: RankingIcon, metric: NumberIcon };
const TYPE_LABELS = { trend: "Tendencia", funnel: "Embudo", retention: "Retención", breakdown: "Ranking", metric: "Número" };
// Clases completas (Tailwind no ve clases armadas con variables).
const SPAN = { 4: "lg:col-span-4", 6: "lg:col-span-6", 8: "lg:col-span-8", 12: "lg:col-span-12" };
const WIDTHS = [{ value: 4, label: "1/3" }, { value: 6, label: "1/2" }, { value: 8, label: "2/3" }, { value: 12, label: "Todo" }];

export default function Dashboards() {
  const { site, canEdit } = useApp();
  const navigate = useNavigate();
  const list = useAsync((signal) => api.get("dashboards/", { site_id: site.id }, { signal }), [site.id]);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboards"
        description="Tableros con los análisis que más mirás, juntos y sobre el mismo rango de fechas."
        actions={canEdit && <Button variant="primary" onClick={() => setCreating(true)}><PlusIcon /> Nuevo dashboard</Button>}
      />
      {list.error && <ErrorNote error={list.error} />}
      {list.data?.length === 0 && (
        <EmptyState title="Todavía no hay dashboards" action={canEdit && <Button variant="primary" onClick={() => setCreating(true)}>Armar el primero</Button>}>
          Guardá análisis en el constructor y combinalos en un tablero: por ejemplo, uno para ventas por WhatsApp y otro para el blog.
        </EmptyState>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.map((dashboard) => (
          <Link key={dashboard.id} to={`/dashboards/${dashboard.id}`}
            className="group rounded-2xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-accent/60">
            <LayoutPreview layout={dashboard.layout} />
            <h2 className="mt-4 truncate text-[17px] font-semibold tracking-tight group-hover:text-accent">{dashboard.name}</h2>
            <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">
              {dashboard.description || `${dashboard.layout.length} análisis`}
            </p>
          </Link>
        ))}
      </div>
      {creating && (
        <DashboardDialog
          siteId={site.id}
          onClose={() => setCreating(false)}
          onSaved={(created) => navigate(`/dashboards/${created.id}?editar=1`)}
        />
      )}
    </div>
  );
}

/** Miniatura de la grilla: un bloque por widget con su ancho real. */
function LayoutPreview({ layout }) {
  if (!layout.length) {
    return <div className="grid h-20 place-items-center rounded-lg border border-dashed border-line text-xs text-muted">Vacío</div>;
  }
  return (
    <div className="grid h-20 grid-cols-12 content-start gap-1 overflow-hidden" aria-hidden="true">
      {layout.slice(0, 9).map((item, i) => (
        <span key={i} className="h-6 rounded-md bg-surface-2 group-hover:bg-accent-wash" style={{ gridColumn: `span ${item.width} / span ${item.width}` }} />
      ))}
    </div>
  );
}

export function DashboardView() {
  const { id } = useParams();
  const { canEdit } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const dashboard = useAsync((signal) => api.get(`dashboards/${id}/`, undefined, { signal }), [id]);
  const [editing, setEditing] = useState(() => new URLSearchParams(window.location.search).has("editar"));
  const [layout, setLayout] = useState([]);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [error, setError] = useState(null);
  const [added, setAdded] = useState({}); // análisis sumados en esta edición, todavía sin guardar

  useEffect(() => {
    if (dashboard.data) setLayout(dashboard.data.layout);
  }, [dashboard.data]);

  if (dashboard.error) return <ErrorNote error={dashboard.error} />;
  if (!dashboard.data) return <p className="text-sm text-muted">Cargando dashboard…</p>;
  const d = dashboard.data;
  const analyses = { ...Object.fromEntries(d.analyses.map((a) => [a.id, a])), ...added };
  const dirty = JSON.stringify(layout) !== JSON.stringify(d.layout);

  const move = (from, to) => {
    if (to < 0 || to >= layout.length || from === to) return;
    const next = [...layout];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setLayout(next);
  };
  const save = async () => {
    setError(null);
    try {
      await api.patch(`dashboards/${d.id}/`, { layout });
      await dashboard.reload();
      setEditing(false);
      toast("Dashboard guardado");
    } catch (err) {
      setError(err);
    }
  };
  const remove = async () => {
    if (!window.confirm(`¿Borrar el dashboard «${d.name}»? Los análisis guardados no se borran.`)) return;
    await api.delete(`dashboards/${d.id}/`);
    toast(`Dashboard «${d.name}» borrado`);
    navigate("/dashboards");
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link to="/dashboards" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><span aria-hidden="true">‹</span> Dashboards</Link>
        <PageHeader
          title={d.name}
          description={d.description}
          actions={canEdit && (editing ? (
            <>
              <Button onClick={() => setAdding(true)}><PlusIcon /> Agregar análisis</Button>
              <Button variant="ghost" onClick={() => setRenaming(true)}>Renombrar</Button>
              <Button variant="danger" onClick={remove}>Borrar</Button>
              <Button onClick={() => { setLayout(d.layout); setEditing(false); }}>Cancelar</Button>
              <Button variant="primary" onClick={save} disabled={!dirty}>Guardar</Button>
            </>
          ) : (
            <Button onClick={() => setEditing(true)}>Editar</Button>
          ))}
        />
      </div>
      {error && <ErrorNote error={error} />}
      {editing && <p className="text-[13px] text-muted">Arrastrá las tarjetas para ordenarlas y elegí el ancho de cada una. Los cambios se aplican al guardar.</p>}

      {layout.length === 0 ? (
        <EmptyState title="Este dashboard está vacío" action={canEdit && <Button variant="primary" onClick={() => { setEditing(true); setAdding(true); }}>Agregar un análisis</Button>}>
          Sumá análisis guardados: tendencias, embudos, rankings o números.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {layout.map((item, index) => {
            const analysis = analyses[item.analysis_id];
            if (!analysis) return null;
            return (
              <div
                key={item.analysis_id}
                className={`${SPAN[item.width]} min-w-0 ${editing ? "cursor-grab rounded-2xl outline-2 outline-offset-4 outline-dashed outline-line" : ""} ${dragIndex === index ? "opacity-40" : ""}`}
                draggable={editing}
                onDragStart={(e) => { setDragIndex(index); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (editing && dragIndex !== null) { e.preventDefault(); if (dragIndex !== index) { move(dragIndex, index); setDragIndex(index); } } }}
                onDragEnd={() => setDragIndex(null)}
              >
                {editing && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/70 px-2 py-1.5">
                    <span aria-hidden="true" className="px-1 text-muted">⋮⋮</span>
                    <Segmented label={`Ancho de ${analysis.name}`} value={item.width} options={WIDTHS}
                      onChange={(width) => setLayout(layout.map((it, i) => (i === index ? { ...it, width } : it)))} />
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" aria-label="Mover antes" onClick={() => move(index, index - 1)} disabled={index === 0}>‹</Button>
                      <Button size="sm" variant="ghost" aria-label="Mover después" onClick={() => move(index, index + 1)} disabled={index === layout.length - 1}>›</Button>
                      <Button size="sm" variant="ghost" onClick={() => setLayout(layout.filter((_, i) => i !== index))}>Quitar</Button>
                    </span>
                  </div>
                )}
                <AnalysisCard analysis={analysis}
                  actions={!editing && <Link to={`/constructor/${analysis.id}`} className="rounded-lg px-2.5 py-1 text-[13px] text-ink-2 hover:bg-surface-2">Abrir</Link>} />
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <AddWidgetDialog
          siteId={d.site_id}
          exclude={layout.map((i) => i.analysis_id)}
          onClose={() => setAdding(false)}
          onAdd={(analysis) => {
            setLayout([...layout, { analysis_id: analysis.id, width: analysis.analysis_type === "metric" ? 4 : analysis.analysis_type === "retention" ? 12 : 6 }]);
            setAdded({ ...added, [analysis.id]: analysis });
            setAdding(false);
          }}
        />
      )}
      {renaming && (
        <DashboardDialog siteId={d.site_id} dashboard={d} onClose={() => setRenaming(false)}
          onSaved={() => { setRenaming(false); dashboard.reload(); toast("Cambios guardados"); }} />
      )}
    </div>
  );
}

function AddWidgetDialog({ siteId, exclude, onClose, onAdd }) {
  const list = useAsync((signal) => api.get("analyses/", { site_id: siteId }, { signal }), [siteId]);
  const available = (list.data || []).filter((a) => !exclude.includes(a.id));
  return (
    <Modal title="Agregar un análisis" onClose={onClose} wide>
      {list.error && <ErrorNote error={list.error} />}
      {list.data && available.length === 0 ? (
        <p className="text-sm text-ink-2">
          {list.data.length ? "Ya agregaste todos los análisis guardados." : "Todavía no hay análisis guardados."}{" "}
          <Link to="/constructor" className="font-medium text-accent hover:underline">Crear uno en el constructor</Link>
        </p>
      ) : (
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {available.map((a) => {
            const Icon = TYPE_ICONS[a.analysis_type] || TrendIcon;
            return (
              <li key={a.id}>
                <button type="button" onClick={() => onAdd(a)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2">
                  <span className="text-accent"><Icon /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.name}</span>
                    <span className="block text-xs text-muted">{TYPE_LABELS[a.analysis_type]}</span>
                  </span>
                  <span className="text-[13px] font-medium text-accent">Agregar</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Cerrar</Button></div>
    </Modal>
  );
}

function DashboardDialog({ siteId, dashboard, onClose, onSaved }) {
  const [values, setValues] = useState({ name: dashboard?.name || "", description: dashboard?.description || "" });
  const [error, setError] = useState(null);
  return (
    <Modal title={dashboard ? "Renombrar dashboard" : "Nuevo dashboard"} onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const body = { name: values.name.trim(), description: values.description.trim() };
          onSaved(dashboard ? await api.patch(`dashboards/${dashboard.id}/`, body) : await api.post("dashboards/", { ...body, site_id: siteId, layout: [] }));
        } catch (err) {
          setError(err);
        }
      }}>
        <Field label="Nombre">
          <input autoFocus required maxLength={200} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} className="w-full" placeholder="Ventas por WhatsApp" />
        </Field>
        <Field label="Descripción (opcional)">
          <textarea rows={2} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} className="w-full" />
        </Field>
        {error && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary">{dashboard ? "Guardar" : "Crear y agregar análisis"}</Button>
        </div>
      </form>
    </Modal>
  );
}
