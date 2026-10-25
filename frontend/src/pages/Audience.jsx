import { useState } from "react";

import HourHeatmap from "../charts/HourHeatmap";
import ReachBars from "../charts/ReachBars";
import ShareBar from "../charts/ShareBar";
import HelpTip from "../components/HelpTip";
import { Button, ErrorNote, PageHeader, Panel, StatTile } from "../components/ui";
import { formatExact } from "../lib/format";
import { useReport } from "../lib/hooks";
import { useApp, useDateParams } from "../state/AppContext";
import { Loading } from "./Acquisition";

const DEVICE_LABELS = { mobile: "Celular", desktop: "Computadora", tablet: "Tablet" };
const countryNames = (() => {
  try {
    return new Intl.DisplayNames(["es"], { type: "region" });
  } catch {
    return null;
  }
})();
const countryName = (code) => (code && code.length === 2 && countryNames ? countryNames.of(code) : code);

export default function Audience() {
  const { site } = useApp();
  const dateParams = useDateParams();
  const report = useReport("reports/audience/", site.id, dateParams);
  const [table, setTable] = useState(false);
  const data = report.data;

  return (
    <div className="space-y-5">
      <PageHeader title="Audiencia" description="Quiénes te visitan, desde dónde y cuándo." />
      {report.error && <ErrorNote error={report.error} />}

      <div className={`grid grid-cols-2 gap-4 lg:grid-cols-4 ${report.loading && data ? "opacity-60" : ""}`}>
        <StatTile label="Sesiones" value={data ? formatExact(data.total_sessions) : "—"} />
        <StatTile label="Visitantes nuevos" value={data ? formatExact(data.new_visitors) : "—"}
          help={<HelpTip>Personas cuya primera visita al sitio fue dentro del rango elegido.</HelpTip>} />
        <StatTile label="Visitantes que vuelven" value={data ? formatExact(data.returning_visitors) : "—"}
          help={<HelpTip>Personas que ya habían venido antes del rango y volvieron.</HelpTip>} />
        <StatTile label="Páginas por sesión" value={data ? String(data.pages_per_session).replace(".", ",") : "—"} />
      </div>

      <Panel
        title={<span className="inline-flex items-center gap-2">Cuándo te visitan <HelpTip>Sesiones por día de la semana y hora, en la zona horaria del sitio ({site.timezone}). Las celdas más oscuras son los momentos con más visitas.</HelpTip></span>}
        description="Sesiones por día y hora"
        actions={<Button size="sm" variant="ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? "Ver mapa" : "Ver tabla"}</Button>}
      >
        {data ? <HourHeatmap grid={data.heatmap} table={table} /> : <Loading />}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Dispositivos" description="Sesiones por tipo de dispositivo">
          {data ? (
            <ShareBar items={data.devices.map((d) => ({ key: d.value, label: DEVICE_LABELS[d.value] || d.value, value: d.sessions }))} />
          ) : <Loading />}
        </Panel>
        <Panel title="Nuevos y recurrentes" description="Visitantes del rango">
          {data ? (
            <ShareBar valueLabel="visitantes" items={[
              { key: "new", label: "Nuevos", value: data.new_visitors },
              { key: "returning", label: "Vuelven", value: data.returning_visitors },
            ]} />
          ) : <Loading />}
        </Panel>
      </div>

      <Panel title={<span className="inline-flex items-center gap-2">Países <HelpTip>Sale de la IP en el momento de la visita (la IP no se guarda). Si ves “sin dato”, falta configurar la base de países en el servidor.</HelpTip></span>}
        description="Sesiones por país">
        {data ? (
          data.countries.length ? (
            <ReachBars rows={data.countries.map((c) => ({ key: c.value, percent: c.percent, value: c.sessions }))}
              labelOf={(r) => (r.key === "(sin dato)" ? "Sin dato" : countryName(r.key))} valueLabel="sesiones" />
          ) : <p className="text-sm text-muted">Sin datos.</p>
        ) : <Loading />}
      </Panel>
    </div>
  );
}
