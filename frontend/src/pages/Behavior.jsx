import { Link, useSearchParams } from "react-router";

import ReachBars from "../charts/ReachBars";
import HelpTip from "../components/HelpTip";
import { BarCell, ErrorNote, PageHeader, Panel, StatTile, Table } from "../components/ui";
import { formatDuration, formatExact, formatPercent } from "../lib/format";
import { useReport } from "../lib/hooks";
import { useApp, useDateParams } from "../state/AppContext";
import { Loading } from "./Acquisition";

function maxCount(rows) {
  return Math.max(1, ...(rows || []).map((r) => r.count));
}

function countColumns(rows, first, extra = []) {
  return [
    first,
    ...extra,
    { key: "count", label: "Veces", render: (r) => <BarCell value={r.count} max={maxCount(rows)} format={formatExact} /> },
    { key: "visitors", label: "Personas", numeric: true, className: "hidden sm:table-cell" },
  ];
}

const shortUrl = (url) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

export default function Behavior() {
  const { site } = useApp();
  const dateParams = useDateParams();
  const [params, setParams] = useSearchParams();
  const page = params.get("pagina") || "";
  const report = useReport("reports/behavior/", site.id, dateParams, page ? { page } : {});
  // Con una página elegida, la lista del filtro sale del reporte general.
  const all = useReport("reports/behavior/", site.id, dateParams, {}, { enabled: Boolean(page) });
  const data = report.data;
  const pages = (page ? all.data : data)?.pages || [];

  const half = data?.scroll.find((s) => s.mark >= 50);
  const avgTime = data && (() => {
    const timed = data.pages.filter((p) => p.avg_time_seconds !== null);
    const views = timed.reduce((s, p) => s + p.views, 0);
    return views ? timed.reduce((s, p) => s + p.avg_time_seconds * p.views, 0) / views : null;
  })();
  const setPage = (value) => setParams(value ? { pagina: value } : {}, { replace: true });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Comportamiento"
        description={page ? `Qué hacen las personas en ${page}.` : "Qué miran, hasta dónde leen y qué clickean."}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-2">Página</span>
            <select value={page} onChange={(e) => setPage(e.target.value)} className="max-w-72">
              <option value="">Todas las páginas</option>
              {page && !pages.some((p) => p.page === page) && <option value={page}>{page}</option>}
              {pages.map((p) => <option key={p.page} value={p.page}>{p.page}</option>)}
            </select>
          </label>
        }
      />
      {report.error && <ErrorNote error={report.error} />}

      <div className={`grid grid-cols-2 gap-4 lg:grid-cols-4 ${report.loading && data ? "opacity-60" : ""}`}>
        <StatTile label="Páginas vistas" value={data ? formatExact(data.page_views) : "—"} />
        <StatTile label="Llegan a la mitad" value={half ? formatPercent(half.percent) : "—"}
          help={<HelpTip>Porcentaje de las páginas vistas en las que la persona scrolleó al menos hasta el {half?.mark || 50}% del contenido.</HelpTip>} />
        <StatTile label="Tiempo medio por página" value={avgTime != null ? formatDuration(avgTime) : "—"}
          help={<HelpTip>Segundos con la pestaña visible, promediados sobre las páginas más vistas.</HelpTip>} />
        <StatTile label="Descargas" value={data ? formatExact(data.downloads.reduce((s, d) => s + d.count, 0)) : "—"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={<span className="inline-flex items-center gap-2">Hasta dónde scrollean <HelpTip>De cada 100 páginas vistas, cuántas llegaron a cada punto de la página. Los cortes se configuran en Captura de datos.</HelpTip></span>}
          description="Alcance sobre las páginas vistas">
          {data ? (
            <ReachBars rows={data.scroll.map((s) => ({ key: s.mark, percent: s.percent, value: s.views }))} labelOf={(r) => `${r.key}%`} />
          ) : <Loading />}
        </Panel>
        <Panel title="Cuánto tiempo se quedan" description="Tiempo visible por página vista">
          {data ? (
            <ReachBars rows={data.time_distribution.map((t) => ({ key: t.label, percent: t.percent, value: t.views }))} labelOf={(r) => r.key} />
          ) : <Loading />}
        </Panel>
      </div>

      {!page && (
        <Panel title="Páginas" description="Elegí una para ver su detalle" bodyClassName="pt-2">
          {data ? (
            <Table
              rows={data.pages}
              rowKey={(r) => r.page}
              onRowClick={(r) => setPage(r.page)}
              empty="Sin páginas vistas en el rango."
              columns={[
                { key: "page", label: "Página", render: (r) => <span className="block max-w-[34ch] truncate font-medium">{r.page}</span> },
                { key: "views", label: "Vistas", render: (r) => <BarCell value={r.views} max={Math.max(1, ...data.pages.map((p) => p.views))} format={formatExact} /> },
                { key: "visitors", label: "Personas", numeric: true, className: "hidden sm:table-cell" },
                { key: "avg_time_seconds", label: "Tiempo medio", numeric: true, className: "hidden md:table-cell whitespace-nowrap", render: (r) => (r.avg_time_seconds == null ? "—" : formatDuration(r.avg_time_seconds)) },
                { key: "scroll_50_rate", label: "Llegan a la mitad", numeric: true, className: "hidden md:table-cell", render: (r) => formatPercent(r.scroll_50_rate) },
              ]}
            />
          ) : <Loading />}
        </Panel>
      )}

      <Panel
        title={<span className="inline-flex items-center gap-2">Qué clickean <HelpTip>Clicks en botones y links, registrados solos. Para contar un botón como evento propio (y usarlo en embudos u objetivos), creá una regla en Captura de datos.</HelpTip></span>}
        description="Botones y links con más clicks"
        actions={<Link to="/captura" className="rounded-lg px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-surface-2">Medir un botón</Link>}
        bodyClassName="pt-2"
      >
        {data ? (
          <Table rows={data.clicks} rowKey={(r) => `${r.text}|${r.element}|${r.href}`}
            empty="Todavía no hay clicks registrados. Si la captura de clicks está apagada, activala en Captura de datos."
            columns={countColumns(data.clicks, {
              key: "text", label: "Elemento",
              render: (r) => (
                <span className="block max-w-[40ch]">
                  <span className="block truncate font-medium">{r.text || "(sin texto)"}</span>
                  <span className="block truncate font-mono text-xs text-muted">{r.element}{r.href ? `  ${r.href}` : ""}</span>
                </span>
              ),
            })} />
        ) : <Loading />}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={<span className="inline-flex items-center gap-2">Clicks de frustración <HelpTip>Tres clicks o más seguidos sobre lo mismo en menos de un segundo. Suele indicar algo que parece clickeable y no responde.</HelpTip></span>} bodyClassName="pt-2">
          {data ? (
            <Table rows={data.rage_clicks} rowKey={(r) => `${r.page}|${r.element}`} empty="Ninguno en este rango. Buena señal."
              columns={countColumns(data.rage_clicks, {
                key: "element", label: "Dónde",
                render: (r) => <span className="block max-w-[30ch]"><span className="block truncate font-mono text-[13px]">{r.element || "(elemento)"}</span><span className="block truncate text-xs text-muted">{r.page}</span></span>,
              })} />
          ) : <Loading />}
        </Panel>
        <Panel title="Links a otros sitios" description="WhatsApp, redes, tiendas externas" bodyClassName="pt-2">
          {data ? (
            <Table rows={data.outbound} rowKey={(r) => r.target_url} empty="Ninguno en este rango."
              columns={countColumns(data.outbound, { key: "target_url", label: "Destino", render: (r) => <span className="block max-w-[34ch] truncate">{shortUrl(r.target_url)}</span> })} />
          ) : <Loading />}
        </Panel>
        <Panel title="Descargas" bodyClassName="pt-2">
          {data ? (
            <Table rows={data.downloads} rowKey={(r) => r.file_url} empty="Ninguna en este rango."
              columns={countColumns(data.downloads, { key: "file_url", label: "Archivo", render: (r) => <span className="block max-w-[34ch] truncate">{r.file_url.split("/").pop()}</span> })} />
          ) : <Loading />}
        </Panel>
        <Panel title="Formularios enviados" bodyClassName="pt-2">
          {data ? (
            <Table rows={data.forms} rowKey={(r) => r.form_id} empty="Ninguno en este rango."
              columns={countColumns(data.forms, { key: "form_id", label: "Formulario", render: (r) => <span className="font-medium">{r.form_id || "(sin id)"}</span> })} />
          ) : <Loading />}
        </Panel>
      </div>

      <Panel title="Eventos propios" description="Reglas sin código, data-track y analytics.track()" bodyClassName="pt-2">
        {data ? (
          <Table rows={data.custom_events} rowKey={(r) => r.event_name}
            empty="Todavía no hay eventos propios. Creá uno en Captura de datos, sin tocar código."
            columns={countColumns(data.custom_events, { key: "event_name", label: "Evento", render: (r) => <code className="text-[13px]">{r.event_name}</code> })} />
        ) : <Loading />}
      </Panel>
    </div>
  );
}
