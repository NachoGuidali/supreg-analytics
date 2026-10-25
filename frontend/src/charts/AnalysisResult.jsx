import { formatExact } from "../lib/format";
import BreakdownBars from "./BreakdownBars";
import { DataTable } from "./chartKit";
import FunnelChart from "./FunnelChart";
import MetricTile from "./MetricTile";
import RetentionHeatmap from "./RetentionHeatmap";
import TrendChart from "./TrendChart";

const MEASURE_LABEL = { count: "Eventos", unique_visitors: "Visitantes únicos", unique_sessions: "Sesiones únicas" };

/** Renderiza la respuesta de run_analysis según su tipo. `table` muestra la vista de tabla. */
export default function AnalysisResult({ result, table = false, compact = false }) {
  const { analysis_type: type, data } = result;
  switch (type) {
    case "trend":
      return <TrendChart data={data} table={table} height={compact ? 200 : 300} />;
    case "funnel":
      return <FunnelChart data={data} table={table} height={compact ? 220 : 320} />;
    case "retention":
      return <RetentionHeatmap data={data} />;
    case "breakdown":
      return <BreakdownBars data={data} table={table} compact={compact} />;
    case "metric":
      return table ? (
        <DataTable
          columns={[
            { key: "period", label: "Período" },
            { key: "value", label: MEASURE_LABEL[data.measure], numeric: true, format: formatExact },
          ]}
          rows={[
            { period: `${result.date_from} – ${result.date_to}`, value: data.value },
            ...(data.previous_value !== undefined
              ? [{ period: `${data.previous_date_from} – ${data.previous_date_to}`, value: data.previous_value }]
              : []),
          ]}
        />
      ) : (
        <MetricTile
          hero={!compact}
          label={`${MEASURE_LABEL[data.measure]} de ${data.event_name}`}
          value={data.value}
          change={"previous_value" in data ? data.change_percent : undefined}
          previous={data.previous_value}
        />
      );
    default:
      return <p className="text-sm text-muted">Tipo de análisis sin visualización: {type}</p>;
  }
}

export function hasTableView(type) {
  return type !== "retention"; // el heatmap ya es una tabla
}
