import { Link } from "react-router";

import BreakdownBars from "../charts/BreakdownBars";
import { Delta } from "../charts/MetricTile";
import TrendChart, { Sparkline } from "../charts/TrendChart";
import AnalysisCard from "../components/AnalysisCard";
import HelpTip from "../components/HelpTip";
import InsightCard from "../components/InsightCard";
import SetupGuide from "../components/SetupGuide";
import { EmptyState, ErrorNote, PageHeader, Panel } from "../components/ui";
import { api } from "../lib/api";
import { formatDuration, formatExact, formatNumber, formatPercent } from "../lib/format";
import { useAsync, useCountUp, useReport } from "../lib/hooks";
import { useApp, useDateParams } from "../state/AppContext";

function useRun(site, dateParams, analysis_type, config) {
  const key = JSON.stringify(config);
  return useAsync(
    (signal) => api.post("analysis/run/", { site_id: site.id, analysis_type, config, ...dateParams }, { signal }),
    [site.id, dateParams.date_from, dateParams.date_to, key]
  );
}

export default function Overview() {
  const { site } = useApp();
  const dateParams = useDateParams();

  const overview = useAsync(
    (signal) => api.get("overview/", { site_id: site.id, ...dateParams }, { signal }),
    [site.id, dateParams.date_from, dateParams.date_to]
  );
  const visitors = useRun(site, dateParams, "trend", { event_name: "page_view", measure: "unique_visitors", group_by: "day" });
  const sessions = useRun(site, dateParams, "trend", { event_name: "session_start", measure: "count", group_by: "day" });
  const pageviews = useRun(site, dateParams, "trend", { event_name: "page_view", measure: "count", group_by: "day" });
  const pages = useRun(site, dateParams, "breakdown", { event_name: "page_view", breakdown_by: "page", measure: "count", limit: 8 });
  const sources = useRun(site, dateParams, "breakdown", { event_name: "session_start", breakdown_by: "utm_source", measure: "count", limit: 6 });
  const referrers = useRun(site, dateParams, "breakdown", { event_name: "session_start", breakdown_by: "referrer", measure: "count", limit: 6 });
  const pinned = useAsync((signal) => api.get("analyses/", { site_id: site.id, is_pinned: "true" }, { signal }), [site.id]);
  const insights = useReport("insights/", site.id, dateParams);
  const goals = useReport("goals/stats/", site.id, dateParams);

  const metrics = overview.data?.metrics;
  const heroVisitors = useCountUp(metrics?.unique_visitors.value);
  const noTraffic = metrics && metrics.sessions.value === 0 && metrics.sessions.previous === 0;
  const series = (state) => state.data?.data.series[0]?.data;

  return (
    <div className="space-y-6">
      <PageHeader title={`Resumen de ${site.name}`} description="Cómo llegan y qué hacen las personas en tu sitio." />
      <SetupGuide siteId={site.id} />
      {overview.error && <ErrorNote error={overview.error} />}
      {noTraffic && (
        <EmptyState
          title="No hay visitas en este rango"
          action={<Link to="/instalacion" className="text-sm font-medium text-accent underline-offset-2 hover:underline">Ver cómo instalar el snippet</Link>}
        >
          Si recién instalaste el script, abrí tu sitio y revisá los eventos en vivo. Si no, probá con un rango de fechas más amplio.
        </EmptyState>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* Protagonista: visitantes únicos, con su evolución. */}
        <section aria-label="Visitantes únicos" className="min-w-0 rounded-2xl border border-line bg-surface p-6 shadow-card">
          <p className="text-sm font-medium text-ink-2">Visitantes únicos</p>
          <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
            <p className="figure text-5xl font-semibold md:text-[64px] md:leading-none" title={formatExact(metrics?.unique_visitors.value)}>
              {metrics ? formatNumber(heroVisitors) : "—"}
            </p>
            <div className="pb-2">{metrics && <Delta change={metrics.unique_visitors.change_percent} />}</div>
          </div>
          <div className={`mt-5 transition-opacity ${visitors.loading ? "opacity-50" : ""}`}>
            {visitors.error ? <ErrorNote error={visitors.error} /> : visitors.data ? <TrendChart data={visitors.data.data} height={240} /> : <div className="h-[240px]" />}
          </div>
        </section>

        <section aria-label="Métricas clave" className={`grid grid-cols-2 gap-4 ${overview.loading && metrics ? "opacity-60" : ""}`}>
          <Kpi label="Sesiones" metric={metrics?.sessions} format={formatNumber} spark={series(sessions)} />
          <Kpi label="Páginas vistas" metric={metrics?.pageviews} format={formatNumber} spark={series(pageviews)} />
          <Kpi label="Tasa de rebote" metric={metrics?.bounce_rate} format={formatPercent} upIsGood={false}
            hint="Sesiones que se fueron en menos de 10 s sin interactuar"
            help="Porcentaje de sesiones que se fueron en menos de 10 segundos, sin interactuar y sin ver otra página. Más bajo es mejor." />
          <Kpi label="Duración media" metric={metrics?.avg_session_duration_seconds} format={formatDuration}
            hint="Tiempo promedio por sesión" help="Tiempo promedio entre el primer y el último evento de cada sesión." />
        </section>
      </div>

      {goals.data?.goals.length > 0 && (
        <section aria-label="Objetivos" className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Objetivos</h2>
            <Link to="/objetivos" className="text-[13px] font-medium text-accent hover:underline">Ver detalle</Link>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {goals.data.goals.slice(0, 4).map((goal) => (
              <div key={goal.id} className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card">
                <p className="truncate text-sm font-medium text-ink-2">{goal.name}</p>
                <p className="figure mt-1 text-[28px] font-semibold leading-tight">{formatNumber(goal.conversions)}</p>
                <p className="text-[13px] text-muted"><span className="tabular text-ink-2">{formatPercent(goal.rate)}</span> de los visitantes</p>
                <div className="mt-1"><Delta change={goal.change_percent} suffix="" /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {insights.data?.insights.length > 0 && (
        <section aria-label="Mejoras" className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Para tener en cuenta</h2>
            <Link to="/mejoras" className="text-[13px] font-medium text-accent hover:underline">Ver todas las mejoras ({insights.data.insights.length})</Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {insights.data.insights.slice(0, 3).map((insight) => <InsightCard key={insight.key} insight={insight} compact />)}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Páginas más vistas" description="Páginas vistas en el rango">
          <Loaded state={pages} empty="Sin páginas vistas.">{(r) => <BreakdownBars data={r.data} compact />}</Loaded>
        </Panel>
        <div className="grid gap-4">
          <Panel title="Campañas" description="Sesiones por utm_source">
            <Loaded state={sources} empty="Sin sesiones.">{(r) => <BreakdownBars data={r.data} compact />}</Loaded>
          </Panel>
          <Panel title="Sitios de origen" description="Sesiones por dominio de referencia">
            <Loaded state={referrers} empty="Sin sesiones.">{(r) => <BreakdownBars data={r.data} compact />}</Loaded>
          </Panel>
        </div>
      </div>

      {pinned.data?.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Análisis fijados</h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {pinned.data.map((analysis) => (
              <AnalysisCard key={analysis.id} analysis={analysis}
                actions={<Link to={`/constructor/${analysis.id}`} className="rounded-lg px-2.5 py-1 text-[13px] text-ink-2 hover:bg-surface-2">Editar</Link>} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ label, metric, format, spark, upIsGood = true, hint, help }) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 shadow-card">
      <p className="flex items-center gap-1.5 text-sm font-medium text-ink-2">{label}{help && <HelpTip>{help}</HelpTip>}</p>
      <p className="figure mt-1 text-[22px] font-semibold leading-tight sm:text-[30px]" title={metric ? formatExact(metric.value) : undefined}>
        {metric ? format(metric.value) : "—"}
      </p>
      <div className="mt-1 min-h-5">{metric && <Delta change={metric.change_percent} upIsGood={upIsGood} suffix="" />}</div>
      <div className="mt-auto pt-3">
        {spark ? <Sparkline values={spark} /> : hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}

function Loaded({ state, children, empty }) {
  if (state.error) return <ErrorNote error={state.error} />;
  if (!state.data) return <p className="py-6 text-sm text-muted">Calculando…</p>;
  if (empty && state.data.data.rows?.length === 0) return <p className="py-2 text-sm text-muted">{empty}</p>;
  return <div className={`transition-opacity ${state.loading ? "opacity-50" : ""}`}>{children(state.data)}</div>;
}
