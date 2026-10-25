import TrendChart from "../charts/TrendChart";
import HelpTip from "../components/HelpTip";
import { BarCell, EmptyState, ErrorNote, PageHeader, Panel, Table } from "../components/ui";
import { formatDuration, formatExact, formatPercent } from "../lib/format";
import { useReport } from "../lib/hooks";
import { useApp, useDateParams } from "../state/AppContext";

export default function Acquisition() {
  const { site } = useApp();
  const dateParams = useDateParams();
  const report = useReport("reports/acquisition/", site.id, dateParams);
  const data = report.data;
  const maxOf = (rows) => Math.max(1, ...(rows || []).map((r) => r.sessions));

  // wide: tablas a todo el ancho; en las de media columna la duración se muestra sólo en pantallas grandes.
  const sessionColumns = (rows, first, wide = false) => [
    first,
    { key: "sessions", label: "Sesiones", render: (r) => <BarCell value={r.sessions} max={maxOf(rows)} format={formatExact} /> },
    { key: "bounce_rate", label: "Rebote", numeric: true, className: "hidden sm:table-cell", render: (r) => formatPercent(r.bounce_rate) },
    { key: "avg_duration_seconds", label: "Duración media", numeric: true, className: `hidden whitespace-nowrap ${wide ? "md:table-cell" : "2xl:table-cell"}`, render: (r) => formatDuration(r.avg_duration_seconds) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Adquisición" description="De dónde llegan las visitas y cuáles se quedan." />
      {report.error && <ErrorNote error={report.error} />}
      {data && data.total_sessions === 0 && (
        <EmptyState title="No hay sesiones en este rango">Probá con un rango de fechas más amplio o revisá la instalación.</EmptyState>
      )}
      <div className={`grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] ${report.loading && data ? "opacity-60" : ""}`}>
        <Panel
          title={<span className="inline-flex items-center gap-2">Canales <HelpTip label="Cómo se arman los canales">
            Se agrupan por origen: <b>Buscadores</b> (Google, Bing), <b>Redes sociales</b>, <b>Publicidad</b> (utm_medium cpc, paid, ads),
            <b> Email</b> (newsletter), <b>Otras campañas</b> (otros utm_source), <b>Otros sitios</b> (links desde otras webs) y
            <b> Directo</b> (escribieron la dirección o usaron un favorito).</HelpTip></span>}
          description="Sesiones por tipo de origen"
          bodyClassName="pt-2"
        >
          {data ? (
            <Table
              rows={data.channels}
              rowKey={(r) => r.key}
              empty="Sin sesiones."
              columns={sessionColumns(data.channels, {
                key: "label", label: "Canal", className: "whitespace-nowrap",
                render: (r) => <span className="block"><span className="font-medium">{r.label}</span><span className="block text-xs text-muted tabular">{formatPercent(r.percent)} de las sesiones</span></span>,
              })}
            />
          ) : <Loading />}
        </Panel>
        <Panel title="Sesiones por canal" description="Evolución diaria">
          {data ? (data.trend.series.length ? <TrendChart data={data.trend} height={300} /> : <p className="text-sm text-muted">Sin datos.</p>) : <Loading />}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Fuentes" description="utm_source o sitio de origen" bodyClassName="pt-2">
          {data ? (
            <Table rows={data.sources} rowKey={(r) => r.source} empty="Sin sesiones."
              columns={sessionColumns(data.sources, {
                key: "source", label: "Fuente",
                render: (r) => <span className="block max-w-[22ch] truncate"><span className="font-medium">{r.source}</span><span className="block text-xs text-muted">{r.channel}</span></span>,
              })} />
          ) : <Loading />}
        </Panel>
        <Panel title="Páginas de entrada" description="Dónde empieza cada sesión" bodyClassName="pt-2">
          {data ? (
            <Table rows={data.landing_pages} rowKey={(r) => r.page} empty="Sin sesiones."
              columns={sessionColumns(data.landing_pages, {
                key: "page", label: "Página", render: (r) => <span className="block max-w-[28ch] truncate font-medium">{r.page}</span>,
              })} />
          ) : <Loading />}
        </Panel>
      </div>

      <Panel
        title={<span className="inline-flex items-center gap-2">Campañas <HelpTip>Sesiones que llegaron con utm_campaign en el link. Agregá ?utm_source=instagram&amp;utm_campaign=promo a los links que compartís para verlas acá.</HelpTip></span>}
        description="Links etiquetados con utm_campaign"
        bodyClassName="pt-2"
      >
        {data ? (
          <Table rows={data.campaigns} rowKey={(r) => `${r.campaign}|${r.source}|${r.medium}`}
            empty="Todavía no llegaron visitas con utm_campaign. Etiquetá tus links de redes, anuncios y newsletters para comparar campañas."
            columns={sessionColumns(data.campaigns, {
              key: "campaign", label: "Campaña",
              render: (r) => <span><span className="font-medium">{r.campaign}</span><span className="block text-xs text-muted">{[r.source, r.medium].filter(Boolean).join(" / ")}</span></span>,
            }, true)} />
        ) : <Loading />}
      </Panel>
    </div>
  );
}

export function Loading() {
  return <p className="px-5 py-6 text-sm text-muted">Calculando…</p>;
}
