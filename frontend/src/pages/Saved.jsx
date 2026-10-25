import { Link, useNavigate } from "react-router";

import AnalysisCard from "../components/AnalysisCard";
import { Button, EmptyState, ErrorNote, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useApp } from "../state/AppContext";

export default function Saved() {
  const { site, canEdit } = useApp();
  const navigate = useNavigate();
  const list = useAsync((signal) => api.get("analyses/", { site_id: site.id }, { signal }), [site.id]);

  const togglePin = async (analysis) => {
    await api.patch(`analyses/${analysis.id}/`, { is_pinned: !analysis.is_pinned });
    list.reload();
  };
  const duplicate = async (analysis) => {
    const { id, created_at, updated_at, ...rest } = analysis; // eslint-disable-line no-unused-vars
    const copy = await api.post("analyses/", { ...rest, name: `${analysis.name} (copia)`, is_pinned: false });
    navigate(`/constructor/${copy.id}`);
  };
  const remove = async (analysis) => {
    if (!window.confirm(`¿Borrar "${analysis.name}"? No se puede deshacer.`)) return;
    await api.delete(`analyses/${analysis.id}/`);
    list.reload();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Análisis guardados"
        description="Se recalculan con el rango de fechas elegido arriba."
        actions={canEdit && (
          <Link to="/constructor" className="rounded-lg bg-accent-fill px-3.5 py-2 text-sm font-medium text-accent-fill-ink hover:bg-accent-fill-hover">
            Nuevo análisis
          </Link>
        )}
      />
      {list.error && <ErrorNote error={list.error} />}
      {list.data && list.data.length === 0 && (
        <EmptyState
          title={canEdit ? "Todavía no guardaste análisis" : "Tu equipo todavía no guardó análisis"}
          action={<Link to="/constructor" className="text-sm font-medium text-accent underline-offset-2 hover:underline">Abrir el constructor</Link>}
        >
          Armá una tendencia, un embudo o una retención en el constructor y guardala con un nombre. Los análisis fijados aparecen en el resumen.
        </EmptyState>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {list.data?.map((analysis) => (
          <AnalysisCard
            key={analysis.id}
            analysis={analysis}
            actions={!canEdit ? (
              <Link to={`/constructor/${analysis.id}`} className="rounded-lg px-2.5 py-1 text-[13px] text-ink-2 hover:bg-surface-2">Abrir</Link>
            ) : (
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-lg px-2.5 py-1 text-[13px] text-ink-2 hover:bg-surface-2" aria-label="Acciones">
                  Acciones
                </summary>
                <div className="animate-pop absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl [transform-origin:top_right]">
                  <MenuItem onClick={() => navigate(`/constructor/${analysis.id}`)}>Editar</MenuItem>
                  <MenuItem onClick={() => duplicate(analysis)}>Duplicar</MenuItem>
                  <MenuItem onClick={() => togglePin(analysis)}>{analysis.is_pinned ? "Quitar del resumen" : "Fijar en el resumen"}</MenuItem>
                  <MenuItem onClick={() => remove(analysis)} danger>Borrar</MenuItem>
                </div>
              </details>
            )}
            className={analysis.analysis_type === "retention" ? "xl:col-span-2" : ""}
          />
        ))}
      </div>
    </div>
  );
}

function MenuItem({ children, danger, onClick }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className={`w-full justify-start rounded-none ${danger ? "text-bad" : ""}`}>
      {children}
    </Button>
  );
}
