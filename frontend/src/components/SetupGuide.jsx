import { Link } from "react-router";

import { api } from "../lib/api";
import { useAsync, useStoredState } from "../lib/hooks";
import { Button } from "./ui";

/** Guía de inicio del sitio: pasos en orden, con progreso. Se oculta al completarla o descartarla. */
export default function SetupGuide({ siteId }) {
  const setup = useAsync((signal) => api.get(`sites/${siteId}/setup/`, undefined, { signal }), [siteId]);
  const [dismissed, setDismissed] = useStoredState(`an.setupDismissed.${siteId}`, false);
  const data = setup.data;
  if (!data || dismissed || data.done === data.total) return null;
  const next = data.steps.find((s) => !s.done);

  return (
    <section aria-label="Guía de inicio" className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">Poné a punto tu sitio</h2>
          <p className="mt-0.5 text-[13px] text-muted">{data.done} de {data.total} pasos. Siguiente: {next.title.toLowerCase()}.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>Ocultar guía</Button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done}>
        <span className="block h-full rounded-full bg-accent-fill transition-[width] duration-700" style={{ width: `${(data.done / data.total) * 100}%` }} />
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {data.steps.map((step, i) => (
          <li key={step.key} className={step.done ? "hidden sm:block" : ""}>
            <Link to={step.link} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
              step.done ? "border-transparent text-muted" : step === next ? "border-accent bg-accent-wash font-medium" : "border-line hover:bg-surface-2"
            }`}>
              <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                step.done ? "bg-good/15 text-good" : "bg-surface-2 text-ink-2"
              }`}>{step.done ? "✓" : i + 1}</span>
              <span className={step.done ? "line-through decoration-line" : ""}>{step.title}</span>
              <span className="sr-only">{step.done ? "(hecho)" : "(pendiente)"}</span>
            </Link>
          </li>
        ))}
      </ol>
      {data.health === "waiting" && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-ink-2">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-fill opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-fill" />
          </span>
          Esperando la primera visita. Apenas pegues el snippet y entres a tu web, este paso se marca solo.
        </p>
      )}
    </section>
  );
}
