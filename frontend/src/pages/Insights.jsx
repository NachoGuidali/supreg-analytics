import InsightCard, { KINDS } from "../components/InsightCard";
import { ErrorNote, PageHeader } from "../components/ui";
import { useReport } from "../lib/hooks";
import { useApp, useDateParams } from "../state/AppContext";

export default function Insights() {
  const { site } = useApp();
  const dateParams = useDateParams();
  const insights = useReport("insights/", site.id, dateParams);
  const list = insights.data?.insights || [];
  const counts = Object.fromEntries(Object.keys(KINDS).map((k) => [k, list.filter((i) => i.kind === k).length]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mejoras"
        description="Lo que cambió en tu tráfico y qué conviene hacer, comparado con el período anterior."
      />
      {insights.error && <ErrorNote error={insights.error} />}
      {insights.data && (
        <p className="text-sm text-ink-2">
          {list.length === 0
            ? "No encontramos nada para destacar en este rango."
            : Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${KINDS[k].label.toLowerCase()}`).join(", ")}
        </p>
      )}
      {!insights.data && !insights.error && <p className="text-sm text-muted">Analizando el período…</p>}
      <div className={`grid gap-4 xl:grid-cols-2 ${insights.loading && insights.data ? "opacity-60" : ""}`}>
        {list.map((insight) => <InsightCard key={insight.key} insight={insight} />)}
      </div>
      <p className="max-w-prose text-[13px] text-muted">
        Las mejoras se calculan con reglas a la vista: comparan este período con el anterior de la misma duración y sólo
        avisan cuando hay volumen suficiente para que la diferencia no sea casualidad.
      </p>
    </div>
  );
}
