import { useMemo, useState } from "react";

import HelpTip from "../components/HelpTip";
import { PlusIcon } from "../components/icons";
import { Button, EmptyState, ErrorNote, Field, Modal, PageHeader, Panel, Switch, Table } from "../components/ui";
import { api } from "../lib/api";
import { formatExact } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useApp } from "../state/AppContext";
import { useToast } from "../state/Toasts";

const AUTO_HELP = {
  scroll_depth: "Hasta qué parte de cada página llegan (en los cortes que elijas abajo).",
  time_on_page: "Segundos con la pestaña visible en cada página.",
  bounce: "Quién se va antes de 10 segundos sin interactuar.",
  click: "Cada click en botones y links, con su texto y destino.",
  rage_click: "Tres clicks seguidos sobre lo mismo: algo que no responde.",
  outbound_click: "Clicks que llevan a otro sitio (WhatsApp, redes, tiendas).",
  file_download: "Clicks en links a PDF, planillas, ZIP y otros archivos.",
  form_submit: "Envíos de formularios, sin guardar lo que escriben.",
  video: "Reproducción, avance y final de los videos de la página.",
};

const KINDS = [
  { value: "click", label: "Click", help: "En un botón, link o cualquier elemento" },
  { value: "pageview", label: "Visita a una página", help: "Como llegar a /gracias" },
  { value: "scroll", label: "Scroll", help: "Hasta un porcentaje de la página" },
  { value: "time", label: "Tiempo", help: "Segundos en una página" },
  { value: "form", label: "Formulario", help: "Envío de un formulario" },
];

const MATCHES = [
  { value: "any", label: "Cualquier página" },
  { value: "equals", label: "Es igual a" },
  { value: "starts_with", label: "Empieza con" },
  { value: "contains", label: "Contiene" },
  { value: "regex", label: "Expresión regular" },
];

const SELECTOR_EXAMPLES = [
  { selector: "a[href*='wa.me']", label: "Links a WhatsApp" },
  { selector: "a[href^='tel:']", label: "Links de teléfono" },
  { selector: "a[href^='mailto:']", label: "Links de email" },
  { selector: ".btn-comprar", label: "Elementos con la clase btn-comprar" },
  { selector: "#cotizar", label: "El elemento con id cotizar" },
];

function slugify(text) {
  const slug = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return (/^[a-z]/.test(slug) ? slug : `evento_${slug}`).slice(0, 100);
}

/** La regla en una frase: lo que se ve en la lista y en la vista previa del formulario. */
export function describeRule(rule) {
  const where = rule.url_match && rule.url_match !== "any"
    ? ` en páginas cuya dirección ${MATCHES.find((m) => m.value === rule.url_match)?.label.toLowerCase()} “${rule.url_value || "…"}”`
    : rule.kind === "pageview" ? "" : " en cualquier página";
  switch (rule.kind) {
    case "click": return `Click en ${rule.selector || "…"}${where}`;
    case "pageview": return `Visita a una página${where || " (elegí cuál)"}`;
    case "scroll": return `Scroll hasta el ${rule.threshold || "…"}%${where}`;
    case "time": return `${rule.threshold || "…"} segundos en la página${where}`;
    case "form": return `Envío de ${rule.selector ? `el formulario ${rule.selector}` : "cualquier formulario"}${where}`;
    default: return rule.kind;
  }
}

export default function Capture() {
  const { site, canEdit } = useApp();
  const toast = useToast();
  const settings = useAsync((signal) => api.get(`sites/${site.id}/tracking/`, undefined, { signal }), [site.id]);
  const rules = useAsync((signal) => api.get("tracking-rules/", { site_id: site.id }, { signal }), [site.id]);
  const catalog = useAsync((signal) => api.get("events/catalog/", { site_id: site.id, days: 30 }, { signal }), [site.id]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const received = useMemo(
    () => Object.fromEntries((catalog.data?.events || []).map((e) => [e.event_name, e.count])),
    [catalog.data]
  );

  const patch = async (body, message) => {
    setError(null);
    try {
      await api.patch(`sites/${site.id}/tracking/`, body);
      settings.reload();
      toast(message);
    } catch (err) {
      setError(err);
    }
  };
  const toggleRule = async (rule) => {
    await api.patch(`tracking-rules/${rule.id}/`, { is_active: !rule.is_active });
    rules.reload();
    toast(rule.is_active ? `«${rule.name}» en pausa` : `«${rule.name}» activa`);
  };
  const removeRule = async (rule) => {
    if (!window.confirm(`¿Borrar «${rule.name}»? Deja de registrarse; lo que ya se registró queda.`)) return;
    await api.delete(`tracking-rules/${rule.id}/`);
    rules.reload();
    toast(`«${rule.name}» borrada`);
  };

  const s = settings.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Captura de datos"
        description="Qué registra el script en tu web. Los cambios llegan solos, sin tocar el código, en unos minutos."
      />
      {!canEdit && <p className="rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-sm text-ink-2">Con el rol de lector podés ver la configuración, pero no cambiarla.</p>}
      {(error || settings.error) && <ErrorNote error={error || settings.error} />}

      <Panel
        title={<span className="inline-flex items-center gap-2">Eventos sin código <HelpTip>Convertí un click, una página, un scroll o un tiempo en un evento con nombre propio. Después lo usás en el constructor, en embudos y como objetivo.</HelpTip></span>}
        description="Medí botones y páginas puntuales sin programar"
        actions={canEdit && <Button size="sm" variant="primary" onClick={() => setEditing({ kind: "click" })}><PlusIcon /> Nuevo evento</Button>}
        bodyClassName="pt-2"
      >
        {rules.error && <div className="px-5"><ErrorNote error={rules.error} /></div>}
        {rules.data && rules.data.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState title="Todavía no hay eventos sin código" action={canEdit && <Button variant="primary" size="sm" onClick={() => setEditing({ kind: "click", name: "Click en WhatsApp", selector: "a[href*='wa.me']" })}>Medir los clicks a WhatsApp</Button>}>
              Por ejemplo: cada click en el botón de WhatsApp, cada visita a la página de gracias, o quién lee el 75% de un artículo.
            </EmptyState>
          </div>
        ) : (
          <Table
            rows={rules.data || []}
            rowKey={(r) => r.id}
            empty="Cargando…"
            columns={[
              {
                key: "name", label: "Evento",
                render: (r) => (
                  <span className="block min-w-0 max-w-[44ch]">
                    <span className="block truncate font-medium">{r.name} <code className="ml-1 text-xs font-normal text-muted">{r.event_name}</code></span>
                    <span className="block truncate text-[13px] text-muted">{describeRule(r)}</span>
                  </span>
                ),
              },
              {
                key: "received", label: <span className="inline-flex items-center gap-1">Últimos 30 días</span>, numeric: true, className: "hidden sm:table-cell",
                render: (r) => (catalog.data ? formatExact(received[r.event_name] || 0) : "…"),
              },
              { key: "is_active", label: "Activa", render: (r) => <Switch checked={r.is_active} disabled={!canEdit} onChange={() => toggleRule(r)} label={`Activar ${r.name}`} /> },
              ...(canEdit ? [{
                key: "actions", label: <span className="sr-only">Acciones</span>, className: "text-right whitespace-nowrap",
                render: (r) => (
                  <span className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeRule(r)}>Borrar</Button>
                  </span>
                ),
              }] : []),
            ]}
          />
        )}
      </Panel>

      <Panel title="Qué se registra solo" description="Captura automática del script. Visitas y sesiones siempre se registran.">
        {s ? (
          <ul className="divide-y divide-line">
            {Object.entries(s.auto_labels).map(([key, label]) => (
              <li key={key} className="flex items-center justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-[13px] text-muted">{AUTO_HELP[key]}</span>
                </span>
                <Switch
                  checked={s.auto[key]}
                  disabled={!canEdit}
                  label={label}
                  onChange={(value) => patch({ auto: { [key]: value } }, `${label}: ${value ? "se registra" : "no se registra"}`)}
                />
              </li>
            ))}
          </ul>
        ) : <p className="py-4 text-sm text-muted">Cargando…</p>}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <ScrollMarks settings={s} canEdit={canEdit} onSave={(marks) => patch({ scroll_marks: marks }, "Cortes de scroll guardados")} />
        <ExcludedPaths settings={s} canEdit={canEdit} onSave={(paths) => patch({ excluded_paths: paths }, "Rutas excluidas guardadas")} />
      </div>

      {editing && (
        <RuleDialog
          siteId={site.id}
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            rules.reload();
            toast(created ? `«${saved.name}» creada. Empieza a registrarse en unos minutos.` : "Cambios guardados");
          }}
        />
      )}
    </div>
  );
}

function ScrollMarks({ settings, canEdit, onSave }) {
  const [draft, setDraft] = useState("");
  if (!settings) return <Panel title="Cortes de scroll"><p className="text-sm text-muted">Cargando…</p></Panel>;
  const marks = settings.scroll_marks;
  const add = () => {
    const value = Number(draft);
    if (Number.isInteger(value) && value >= 1 && value <= 100 && !marks.includes(value) && marks.length < 10) {
      onSave([...marks, value]);
      setDraft("");
    }
  };
  return (
    <Panel title="Cortes de scroll" description="En qué porcentajes de la página se registra el avance">
      <div className="flex flex-wrap items-center gap-2">
        {marks.map((mark) => (
          <span key={mark} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-1 pl-3 pr-1 text-sm tabular">
            {mark}%
            {canEdit && marks.length > 1 && (
              <button type="button" aria-label={`Quitar ${mark}%`} onClick={() => onSave(marks.filter((m) => m !== mark))}
                className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink">×</button>
            )}
          </span>
        ))}
      </div>
      {canEdit && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input type="number" min={1} max={100} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ej: 90" aria-label="Nuevo corte" className="w-28" />
          <Button type="submit" disabled={!draft}>Agregar</Button>
        </form>
      )}
    </Panel>
  );
}

function ExcludedPaths({ settings, canEdit, onSave }) {
  const [draft, setDraft] = useState("");
  if (!settings) return <Panel title="Páginas que no se miden"><p className="text-sm text-muted">Cargando…</p></Panel>;
  const paths = settings.excluded_paths;
  return (
    <Panel
      title={<span className="inline-flex items-center gap-2">Páginas que no se miden <HelpTip>Útil para el panel de administración, páginas de pago o de prueba. Terminá con * para incluir todo lo que cuelga: /admin* excluye /admin/usuarios.</HelpTip></span>}
      description="Ni visitas ni eventos en estas rutas"
    >
      {paths.length === 0 ? <p className="text-sm text-muted">Se mide todo el sitio.</p> : (
        <ul className="space-y-1.5">
          {paths.map((path) => (
            <li key={path} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-1.5">
              <code className="text-[13px]">{path}</code>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => onSave(paths.filter((p) => p !== path))}>Quitar</Button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          const value = draft.trim();
          if (value && !paths.includes(value)) onSave([...paths, value.startsWith("/") ? value : `/${value}`]);
          setDraft("");
        }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="/admin*" aria-label="Ruta a excluir" className="min-w-0 flex-1 font-mono text-[13px]" />
          <Button type="submit" disabled={!draft.trim()}>Agregar</Button>
        </form>
      )}
    </Panel>
  );
}

function RuleDialog({ siteId, rule, onClose, onSaved }) {
  const editing = Boolean(rule.id);
  const [values, setValues] = useState({
    name: rule.name || "", event_name: rule.event_name || (rule.name ? slugify(rule.name) : ""), kind: rule.kind || "click",
    selector: rule.selector || "", url_match: rule.url_match || (rule.kind === "pageview" ? "equals" : "any"),
    url_value: rule.url_value || "", threshold: rule.threshold ?? (rule.kind === "scroll" ? 75 : rule.kind === "time" ? 30 : ""),
  });
  const [autoSlug, setAutoSlug] = useState(!editing && !rule.event_name);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));
  const setKind = (kind) => setValues((v) => ({
    ...v, kind,
    url_match: kind === "pageview" && v.url_match === "any" ? "equals" : v.url_match,
    threshold: kind === "scroll" ? (v.threshold || 75) : kind === "time" ? (v.threshold || 30) : "",
  }));
  const needsSelector = values.kind === "click" || values.kind === "form";
  const needsThreshold = values.kind === "scroll" || values.kind === "time";

  return (
    <Modal title={editing ? "Editar evento sin código" : "Nuevo evento sin código"} onClose={onClose} wide>
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const body = {
            name: values.name.trim(), event_name: values.event_name.trim(), kind: values.kind,
            selector: needsSelector ? values.selector.trim() : "", url_match: values.url_match,
            url_value: values.url_match === "any" ? "" : values.url_value.trim(),
            threshold: needsThreshold ? Number(values.threshold) || null : null,
          };
          try {
            const saved = editing ? await api.patch(`tracking-rules/${rule.id}/`, body) : await api.post("tracking-rules/", { ...body, site_id: siteId });
            onSaved(saved, !editing);
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink-2">Qué tiene que pasar</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {KINDS.map((k) => (
              <label key={k.value} className={`cursor-pointer rounded-xl border p-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${values.kind === k.value ? "border-accent bg-accent-wash" : "border-line hover:bg-surface-2"}`}>
                <input type="radio" name="kind" value={k.value} checked={values.kind === k.value} onChange={() => setKind(k.value)} className="sr-only" />
                <span className="block text-sm font-medium">{k.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">{k.help}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {needsSelector && (
          <Field
            label={values.kind === "click" ? "Elemento (selector CSS)" : "Formulario (selector CSS, opcional)"}
            hint={values.kind === "click"
              ? "En tu web: clic derecho sobre el botón, Inspeccionar, y copiá su id (#id) o una clase (.clase). También cuenta el click en algo que esté adentro del elemento."
              : "Vacío = cualquier formulario. Por ejemplo #contacto o form.newsletter."}
          >
            <input required={values.kind === "click"} value={values.selector} onChange={(e) => set("selector", e.target.value)}
              className="w-full font-mono text-[13px]" placeholder={values.kind === "click" ? "a[href*='wa.me']" : "#contacto"} spellCheck={false} />
            {values.kind === "click" && (
              <span className="mt-2 flex flex-wrap gap-1.5">
                {SELECTOR_EXAMPLES.map((ex) => (
                  <button key={ex.selector} type="button" onClick={() => set("selector", ex.selector)} title={ex.label}
                    className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2 hover:border-accent hover:text-ink">
                    {ex.label}
                  </button>
                ))}
              </span>
            )}
          </Field>
        )}

        {needsThreshold && (
          <Field label={values.kind === "scroll" ? "Porcentaje de la página" : "Segundos con la página visible"}>
            <input required type="number" min={1} max={values.kind === "scroll" ? 100 : 3600} value={values.threshold}
              onChange={(e) => set("threshold", e.target.value)} className="w-32" />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <Field label="Página">
            <select value={values.url_match} onChange={(e) => set("url_match", e.target.value)} className="w-full">
              {MATCHES.filter((m) => values.kind !== "pageview" || m.value !== "any").map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          {values.url_match !== "any" && (
            <Field label="Dirección" hint="La ruta sin el dominio, como /gracias o /productos/.">
              <input required value={values.url_value} onChange={(e) => set("url_value", e.target.value)} className="w-full font-mono text-[13px]" placeholder="/gracias" />
            </Field>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre para mostrar">
            <input required maxLength={120} value={values.name} className="w-full" placeholder="Click en WhatsApp"
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value, event_name: autoSlug ? slugify(e.target.value) : v.event_name }))} />
          </Field>
          <Field label="Nombre del evento" hint="Así aparece en el constructor y en los objetivos.">
            <input required value={values.event_name} className="w-full font-mono text-[13px]" placeholder="click_whatsapp" spellCheck={false}
              onChange={(e) => { setAutoSlug(false); set("event_name", e.target.value); }} />
          </Field>
        </div>

        <p className="rounded-xl bg-surface-2/70 px-4 py-3 text-sm">
          <span className="text-muted">Se va a registrar </span>
          <code className="font-medium">{values.event_name || "…"}</code>
          <span className="text-muted"> cada vez que ocurra: </span>
          {describeRule(values)}.
        </p>

        {error && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>{editing ? "Guardar cambios" : "Crear evento"}</Button>
        </div>
      </form>
    </Modal>
  );
}
