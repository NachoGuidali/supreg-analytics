import { Link } from "react-router";

import { Delta } from "../charts/MetricTile";

// Estado con ícono + texto, nunca sólo color. Los tonos no se reutilizan para series.
export const KINDS = {
  critical: { label: "Urgente", tone: "text-bad", icon: "!" },
  warning: { label: "Para revisar", tone: "text-status-warning", icon: "▲" },
  positive: { label: "Buena noticia", tone: "text-good", icon: "↑" },
  tip: { label: "Para mejorar", tone: "text-status-tip", icon: "✦" },
  info: { label: "Dato", tone: "text-ink-2", icon: "i" },
};

export default function InsightCard({ insight, compact = false }) {
  const kind = KINDS[insight.kind] || KINDS.info;
  return (
    <article className="flex min-w-0 gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-current/10 text-sm font-bold ${kind.tone}`}>
        <span className={kind.tone}>{kind.icon}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-medium ${kind.tone}`}>{kind.label}</p>
        <h3 className="mt-0.5 text-[17px] font-semibold leading-snug tracking-tight">{insight.title}</h3>
        {!compact && <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{insight.body}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {insight.metric?.change_percent != null && <Delta change={insight.metric.change_percent} />}
          {insight.action && (
            <Link to={insight.action.to} className="text-[13px] font-medium text-accent underline-offset-2 hover:underline">
              {insight.action.label}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
