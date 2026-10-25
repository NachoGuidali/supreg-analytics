import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import AnalysisResult, { hasTableView } from "../charts/AnalysisResult";
import { FunnelIcon, NumberIcon, RankingIcon, RetentionIcon, TrendIcon } from "../components/icons";
import { Button, ErrorNote, Field, Modal } from "../components/ui";
import ConfigForm from "../builder/ConfigForms";
import { ANALYSIS_TYPES, defaultConfig, describe, fromApiConfig, mainEvent, toApiConfig } from "../builder/definitions";
import { api } from "../lib/api";
import { useAsync, useDebounced } from "../lib/hooks";
import { useApp, useDateParams } from "../state/AppContext";

const TYPE_ICONS = { trend: TrendIcon, funnel: FunnelIcon, retention: RetentionIcon, breakdown: RankingIcon, metric: NumberIcon };

export default function Builder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { site, selectSite, canEdit } = useApp();
  const dateParams = useDateParams();

  const [searchParams] = useSearchParams();
  const [type, setType] = useState("trend");
  // Una config por tipo: cambiar de tipo y volver no pierde lo armado. ?evento= arranca con ese evento.
  const [configs, setConfigs] = useState(() => ({ trend: defaultConfig("trend", searchParams.get("evento") || "page_view") }));
  const [saved, setSaved] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(null); // null | "new" | "update"
  const [table, setTable] = useState(false);

  useEffect(() => {
    if (!id) {
      setSaved(null);
      return;
    }
    api.get(`analyses/${id}/`)
      .then((analysis) => {
        setSaved(analysis);
        setType(analysis.analysis_type);
        setConfigs({ [analysis.analysis_type]: fromApiConfig(analysis.analysis_type, analysis.config) });
        if (site && analysis.site_id !== site.id) selectSite(analysis.site_id);
      })
      .catch(setLoadError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const config = configs[type];
  const changeType = (nextType) => {
    setType(nextType);
    setConfigs((current) =>
      current[nextType] ? current : { ...current, [nextType]: defaultConfig(nextType, mainEvent(type, config)) }
    );
  };
  const setConfig = (next) => setConfigs((current) => ({ ...current, [type]: next }));

  const apiConfig = useMemo(() => toApiConfig(type, config), [type, config]);
  const request = useDebounced(
    useMemo(() => JSON.stringify({ type, apiConfig, site: site?.id, ...dateParams }), [type, apiConfig, site, dateParams]),
    500
  );
  const preview = useAsync(
    (signal) => {
      const { type: t, apiConfig: c, site: s, date_from, date_to } = JSON.parse(request);
      return api.post("analysis/run/", { site_id: s, analysis_type: t, config: c, date_from, date_to }, { signal });
    },
    [request],
    { enabled: Boolean(site && apiConfig && JSON.parse(request).apiConfig) }
  );
  const showingCurrentType = preview.data?.analysis_type === type;
  const stale = preview.loading || request !== JSON.stringify({ type, apiConfig, site: site?.id, ...dateParams });

  const save = async ({ name, description, asNew }) => {
    const body = { site_id: site.id, name, description, analysis_type: type, config: apiConfig };
    if (saved && !asNew) {
      const updated = await api.patch(`analyses/${saved.id}/`, body);
      setSaved(updated);
    } else {
      const created = await api.post("analyses/", body);
      navigate(`/constructor/${created.id}`, { replace: Boolean(saved) });
    }
    setSaving(null);
  };

  if (loadError) return <ErrorNote error={loadError} />;
  if (!site) return null;

  const sentence = describe(type, config);
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{saved ? saved.name : "Nuevo análisis"}</h1>
          {saved?.description && <p className="text-sm text-ink-2">{saved.description}</p>}
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            {saved && (
              <Button onClick={() => setSaving("new")} disabled={!apiConfig}>Guardar como nuevo</Button>
            )}
            <Button variant="primary" onClick={() => setSaving(saved ? "update" : "new")} disabled={!apiConfig}>
              {saved ? "Guardar cambios" : "Guardar análisis"}
            </Button>
          </div>
        ) : (
          <p className="text-[13px] text-muted">Con el rol de lector podés explorar, pero no guardar análisis.</p>
        )}
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
        <section aria-label="Configuración" className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div role="radiogroup" aria-label="Tipo de análisis" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {ANALYSIS_TYPES.map((option) => {
              const Icon = TYPE_ICONS[option.value];
              return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={type === option.value}
                title={option.help}
                onClick={() => changeType(option.value)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                  type === option.value
                    ? "border-accent bg-accent-wash font-medium text-ink"
                    : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <span className={type === option.value ? "text-accent" : "text-muted"}><Icon /></span>
                {option.label}
              </button>
              );
            })}
          </div>
          <p className="text-[13px] text-muted">{ANALYSIS_TYPES.find((t) => t.value === type).help}</p>
          <ConfigForm type={type} config={config} onChange={setConfig} siteId={site.id} />
        </section>

        <section aria-label="Vista previa" className="min-w-0 rounded-2xl border border-line bg-surface shadow-card lg:sticky lg:top-20">
          <div className="border-b border-line px-6 py-5">
            <p className="text-[24px] leading-snug tracking-tight text-ink-2 [text-wrap:balance]">
              {sentence.map((part, i) =>
                part.strong !== undefined ? (
                  <strong key={i} className={`font-semibold ${part.missing ? "text-muted" : "text-ink"}`}>{part.strong}</strong>
                ) : (
                  <span key={i}>{part.text}</span>
                )
              )}
            </p>
          </div>
          <div className="p-6">
            {!apiConfig ? (
              <p className="text-sm text-muted">Completá los campos marcados con … para ver el resultado.</p>
            ) : preview.error ? (
              <ErrorNote error={preview.error} />
            ) : preview.data && showingCurrentType ? (
              <div className={`space-y-3 transition-opacity ${stale ? "opacity-50" : ""}`} aria-busy={stale}>
                {hasTableView(type) && (
                  <div className="flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>
                      {table ? "Ver gráfico" : "Ver tabla"}
                    </Button>
                  </div>
                )}
                <AnalysisResult result={preview.data} table={table} />
              </div>
            ) : (
              <p className="text-sm text-muted">Calculando…</p>
            )}
          </div>
        </section>
      </div>

      {saving && (
        <SaveDialog
          initial={saving === "update" ? saved : { name: "", description: "" }}
          title={saving === "update" ? "Guardar cambios" : "Guardar análisis"}
          onCancel={() => setSaving(null)}
          onSave={(values) => save({ ...values, asNew: saving === "new" })}
        />
      )}
    </div>
  );
}

function SaveDialog({ initial, title, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onCancel}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({ name: name.trim(), description: description.trim() });
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        <Field label="Nombre">
          <input autoFocus required maxLength={200} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Conversión a WhatsApp desde Instagram" className="w-full" />
        </Field>
        <Field label="Descripción (opcional)">
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full" />
        </Field>
        {error && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{title}</Button>
        </div>
      </form>
    </Modal>
  );
}
