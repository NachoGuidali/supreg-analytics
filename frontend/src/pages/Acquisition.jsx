import { useState } from "react";
import { Link } from "react-router";

import TrendChart from "../charts/TrendChart";
import HelpTip from "../components/HelpTip";
import { BarCell, Button, EmptyState, ErrorNote, Modal, PageHeader, Panel, StatTile, Table, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { formatDuration, formatExact, formatPercent } from "../lib/format";
import { useAsync, useReport, useStoredState } from "../lib/hooks";
import { useApp, useDateParams } from "../state/AppContext";

const maxOf = (rows) => Math.max(1, ...(rows || []).map((r) => r.sessions));

// wide: tablas a todo el ancho; en las de media columna la duración se muestra sólo en pantallas grandes.
// Con un objetivo elegido, la duración deja lugar a las conversiones.
function sessionColumns(rows, first, { wide = false, goal = false } = {}) {
  const columns = [
    first,
    { key: "sessions", label: "Sesiones", render: (r) => <BarCell value={r.sessions} max={maxOf(rows)} format={formatExact} /> },
    {
      key: "bounce_rate", label: "Rebote", numeric: true,
      className: `hidden ${goal && !wide ? "2xl:table-cell" : "sm:table-cell"}`, render: (r) => formatPercent(r.bounce_rate),
    },
  ];
  if (goal) {
    columns.push({
      key: "conversions", label: "Conversiones", numeric: true,
      render: (r) => (
        <span className="block whitespace-nowrap">
          <span className="font-medium">{formatExact(r.conversions)}</span>
          <span className="block text-xs text-muted">{formatPercent(r.conversion_rate)}</span>
        </span>
      ),
    });
  }
  if (!goal || wide) {
    columns.push({
      key: "avg_duration_seconds", label: "Duración media", numeric: true,
      className: `hidden whitespace-nowrap ${wide ? "md:table-cell" : "2xl:table-cell"}`,
      render: (r) => formatDuration(r.avg_duration_seconds),
    });
  }
  return columns;
}

/** Objetivo con el que se cuentan conversiones; se recuerda por sitio. */
function useGoalChoice(siteId) {
  const goals = useAsync((signal) => api.get("goals/", { site_id: siteId }, { signal }), [siteId]);
  const [stored, setStored] = useStoredState(`acquisition-goal:${siteId}`, "");
  const list = goals.data || [];
  const goal = list.find((g) => g.id === stored) || null;
  return { goals: list, goal, setGoal: setStored };
}

export default function Acquisition() {
  const { site } = useApp();
  const dateParams = useDateParams();
  const { goals, goal, setGoal } = useGoalChoice(site.id);
  const report = useReport("reports/acquisition/", site.id, dateParams, goal ? { goal: goal.id } : {});
  const [campaign, setCampaign] = useState(null);
  const data = report.data;
  const withGoal = Boolean(goal && data?.channels?.[0] && "conversions" in data.channels[0]);
  const options = { goal: withGoal };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Adquisición"
        description="De dónde llegan las visitas, qué campañas y anuncios funcionan, y cuáles convierten."
        actions={
          <label className="flex items-center gap-2 text-sm text-ink-2">
            Conversiones de
            <select value={goal?.id || ""} onChange={(e) => setGoal(e.target.value)} className="max-w-60" disabled={!goals.length}>
              <option value="">{goals.length ? "Ningún objetivo" : "Sin objetivos creados"}</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        }
      />
      {!goals.length && (
        <p className="text-sm text-ink-2">
          Para ver qué canal, campaña o anuncio trae clientes, <Link to="/objetivos" className="font-medium text-accent underline-offset-2 hover:underline">creá un objetivo</Link> (por ejemplo, el click en WhatsApp) y elegilo arriba.
        </p>
      )}
      {report.error && <ErrorNote error={report.error} />}
      {data && data.total_sessions === 0 && (
        <EmptyState title="No hay sesiones en este rango">Probá con un rango de fechas más amplio o revisá la instalación.</EmptyState>
      )}
      <div className={`grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] ${report.loading && data ? "opacity-60" : ""}`}>
        <Panel
          title={<span className="inline-flex items-center gap-2">Canales <HelpTip label="Cómo se arman los canales">
            Se agrupan por origen: <b>Publicidad</b> (links con utm_medium cpc, paid o ads, y anuncios de Google, Microsoft o TikTok aunque no tengan UTM),
            <b> Buscadores</b> (Google, Bing), <b>Redes sociales</b>, <b>Email</b> (newsletter), <b>Otras campañas</b> (otros utm_source),
            <b> Otros sitios</b> (links desde otras webs) y <b>Directo</b> (escribieron la dirección o usaron un favorito).</HelpTip></span>}
          description={withGoal ? `Sesiones y conversiones en «${goal.name}»` : "Sesiones por tipo de origen"}
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
              }, options)}
            />
          ) : <Loading />}
        </Panel>
        <Panel title="Sesiones por canal" description="Evolución diaria">
          {data ? (data.trend.series.length ? <TrendChart data={data.trend} height={300} /> : <p className="text-sm text-muted">Sin datos.</p>) : <Loading />}
        </Panel>
      </div>

      <Panel
        title={<span className="inline-flex items-center gap-2">Campañas <HelpTip>
          Visitas que llegaron con utm_campaign en el link. Tocá una campaña para verla por anuncio (utm_content) y palabra clave (utm_term).
          Los links se arman con el generador de la sección Ayuda.</HelpTip></span>}
        description="Links etiquetados con utm_campaign: redes, anuncios, newsletters"
        bodyClassName="pt-2"
        actions={<Link to="/ayuda#utm" className="text-[13px] font-medium text-accent underline-offset-2 hover:underline">Armar un link</Link>}
      >
        {data ? (
          <Table rows={data.campaigns} rowKey={(r) => `${r.campaign}|${r.source}|${r.medium}`}
            onRowClick={setCampaign}
            empty="Todavía no llegaron visitas con utm_campaign. Etiquetá los links de tus publicaciones, anuncios y newsletters para comparar qué trae más clientes."
            columns={sessionColumns(data.campaigns, {
              key: "campaign", label: "Campaña",
              render: (r) => (
                <button type="button" onClick={(e) => { e.stopPropagation(); setCampaign(r); }} className="block max-w-[34ch] text-left">
                  <span className="block truncate font-medium underline-offset-2 hover:underline">{r.campaign}</span>
                  <span className="block truncate text-xs text-muted">{[r.source, r.medium].filter(Boolean).join(" / ")}</span>
                </button>
              ),
            }, { ...options, wide: true })} />
        ) : <Loading />}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title={<span className="inline-flex items-center gap-2">Fuentes <HelpTip>
            La plataforma de anuncios (Google Ads, Microsoft Ads, TikTok Ads), el utm_source del link o el sitio desde el que llegaron.
            Las variantes de una misma red se suman juntas: l.instagram.com, instagram.com y utm_source=ig figuran como Instagram.</HelpTip></span>}
          description="De qué sitio o plataforma vino cada visita"
          bodyClassName="pt-2"
        >
          {data ? (
            <Table rows={data.sources} rowKey={(r) => r.source} empty="Sin sesiones."
              columns={sessionColumns(data.sources, {
                key: "source", label: "Fuente",
                render: (r) => <span className="block max-w-[22ch] truncate"><span className="font-medium">{r.source}</span><span className="block text-xs text-muted">{r.channel}</span></span>,
              }, options)} />
          ) : <Loading />}
        </Panel>
        <Panel title="Páginas de entrada" description="Dónde empieza cada sesión" bodyClassName="pt-2">
          {data ? (
            <Table rows={data.landing_pages} rowKey={(r) => r.page} empty="Sin sesiones."
              columns={sessionColumns(data.landing_pages, {
                key: "page", label: "Página", render: (r) => <span className="block max-w-[28ch] truncate font-medium">{r.page}</span>,
              }, options)} />
          ) : <Loading />}
        </Panel>
      </div>

      {campaign && <CampaignDialog campaign={campaign} goal={goal} onClose={() => setCampaign(null)} />}
    </div>
  );
}

const BREAKDOWNS = [
  { value: "contents", label: "Anuncio o pieza", column: "utm_content", empty: "Agregá utm_content a cada anuncio o publicación para compararlos." },
  { value: "terms", label: "Palabra clave", column: "utm_term", empty: "utm_term se usa en anuncios de buscadores para saber qué búsqueda trajo la visita." },
  { value: "landing_pages", label: "Página de entrada", column: "Página", empty: "Sin sesiones." },
];

function CampaignDialog({ campaign, goal, onClose }) {
  const { site } = useApp();
  const dateParams = useDateParams();
  const [tab, setTab] = useState("contents");
  const detail = useReport("reports/campaign/", site.id, dateParams, {
    campaign: campaign.campaign, source: campaign.source, medium: campaign.medium, ...(goal ? { goal: goal.id } : {}),
  });
  const data = detail.data;
  const withGoal = Boolean(data && "conversions" in data.totals);
  const breakdown = BREAKDOWNS.find((b) => b.value === tab);
  const rows = data?.[tab] || [];
  // Con un solo valor vacío no hay nada que comparar: se muestra la explicación.
  const onlyEmpty = rows.length === 1 && rows[0].value.startsWith("(sin ");

  return (
    <Modal title={campaign.campaign} onClose={onClose} wide="xl">
      <div className="space-y-5">
        <p className="-mt-2 text-sm text-ink-2">
          {[campaign.source, campaign.medium].filter(Boolean).join(" / ") || "Sin fuente ni medio"}
          {withGoal && `. Conversiones: sesiones con «${goal.name}».`}
        </p>
        {detail.error && <ErrorNote error={detail.error} />}
        {data ? (
          <>
            <div className={`grid grid-cols-2 gap-3 ${withGoal ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
              <StatTile label="Sesiones" value={formatExact(data.totals.sessions)} />
              <StatTile label="Rebote" value={formatPercent(data.totals.bounce_rate)} />
              <StatTile label="Duración media" value={formatDuration(data.totals.avg_duration_seconds)} />
              {withGoal && (
                <StatTile label="Conversiones" value={formatExact(data.totals.conversions)}>
                  <span className="text-[13px] text-muted">{formatPercent(data.totals.conversion_rate)} de las sesiones</span>
                </StatTile>
              )}
            </div>
            <TrendChart data={data.trend} height={180} />
            <div className="space-y-2">
              <Tabs label="Ver la campaña por" tabs={BREAKDOWNS} value={tab} onChange={setTab} />
              {onlyEmpty ? (
                <p className="py-4 text-sm text-muted">{breakdown.empty}</p>
              ) : (
                <div className="-mx-6 sm:-mx-5">
                  <Table rows={rows} rowKey={(r) => r.value} empty="Sin sesiones."
                    columns={sessionColumns(rows, {
                      key: "value", label: breakdown.column,
                      render: (r) => <span className="block max-w-[32ch] truncate font-medium">{r.value}</span>,
                    }, { goal: withGoal, wide: true })} />
                </div>
              )}
            </div>
          </>
        ) : !detail.error && <Loading />}
        <div className="flex justify-end">
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Modal>
  );
}

export function Loading() {
  return <p className="px-5 py-6 text-sm text-muted">Calculando…</p>;
}
