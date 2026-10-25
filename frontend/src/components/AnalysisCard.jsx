import { useState } from "react";

import AnalysisResult, { hasTableView } from "../charts/AnalysisResult";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useDateParams } from "../state/AppContext";
import { Button, ErrorNote, Panel } from "./ui";

/** Tarjeta que ejecuta un análisis guardado sobre el rango de fechas global. */
export default function AnalysisCard({ analysis, actions, className = "" }) {
  const dateParams = useDateParams();
  const [table, setTable] = useState(false);
  const result = useAsync(
    (signal) => api.get(`analyses/${analysis.id}/run/`, dateParams, { signal }),
    [analysis.id, analysis.updated_at, dateParams.date_from, dateParams.date_to]
  );

  return (
    <Panel
      className={className}
      title={analysis.name}
      description={analysis.description}
      actions={
        <>
          {hasTableView(analysis.analysis_type) && (
            <Button size="sm" variant="ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>
              {table ? "Gráfico" : "Tabla"}
            </Button>
          )}
          {actions}
        </>
      }
    >
      {result.error ? (
        <ErrorNote error={result.error} />
      ) : result.data ? (
        <div className={`transition-opacity ${result.loading ? "opacity-50" : ""}`}>
          <AnalysisResult result={result.data} table={table} compact />
        </div>
      ) : (
        <p className="py-8 text-sm text-muted">Calculando…</p>
      )}
    </Panel>
  );
}
