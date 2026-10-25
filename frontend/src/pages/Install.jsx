import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { Button, CopyButton, EmptyState, ErrorNote, Field, PageHeader, Panel } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useApp } from "../state/AppContext";
import { useToast } from "../state/Toasts";

// URL pública del backend que sirve analytics.js. En el mismo origen que el dashboard por defecto.
const BACKEND_URL = (import.meta.env.VITE_PUBLIC_BACKEND_URL || window.location.origin).replace(/\/+$/, "");

const AUTO_EVENTS = [
  ["page_view", "Cada página vista, también los cambios de ruta en apps de una sola página."],
  ["session_start", "Primer evento de cada sesión, con origen y campaña."],
  ["scroll_depth", "Al llegar al 25, 50, 75 y 100% de la página."],
  ["time_on_page", "Segundos visibles en la página, al salir."],
  ["bounce", "Salida antes de 10 segundos sin interactuar."],
  ["click", "Clicks en botones y links, con su texto y destino."],
  ["rage_click", "Tres clicks o más en el mismo elemento en menos de un segundo."],
  ["outbound_click", "Clicks en links a otros dominios."],
  ["file_download", "Clicks en links a PDF, planillas, ZIP y otros archivos."],
  ["form_submit", "Envío de cualquier formulario (sin los valores de los campos)."],
  ["video_play, video_progress, video_complete", "Reproducción de elementos <video>."],
];

export default function Install() {
  const { site, sites, reloadSites, selectSite, isOwner, canCreateSites } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(canCreateSites && (!sites?.length || params.has("nuevo")));

  useEffect(() => {
    if (canCreateSites && (!sites?.length || params.has("nuevo"))) setCreating(true);
  }, [sites, params, canCreateSites]);
  const stopCreating = () => {
    setCreating(false);
    if (params.has("nuevo")) setParams({}, { replace: true });
  };

  const snippet = site
    ? `<script src="${BACKEND_URL}/static/analytics.js" data-api-key="${site.api_key}" defer></script>`
    : "";
  const stub = `<script>
  window.analytics = window.analytics || { track: function () { (analytics.q = analytics.q || []).push(arguments); } };
</script>`;
  const declarative = `<a href="https://wa.me/5491100000000" data-track="whatsapp_click" data-track-location="header">
  Escribinos por WhatsApp
</a>

<button data-track="cta_click" data-track-plan="pro" data-track-button-color="green">
  Quiero el plan Pro
</button>`;
  const programmatic = `analytics.track("video_played", { video_id: "demo", duration: 120 });`;

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title="Instalación"
        description="Pegá el snippet en todas las páginas del sitio, antes de cerrar la etiqueta </head>."
        actions={!creating && canCreateSites && <Button onClick={() => setCreating(true)}>Agregar otro sitio</Button>}
      />

      {creating && (
        <SiteForm
          title={sites?.length ? "Nuevo sitio" : "Registrá tu primer sitio"}
          onCancel={sites?.length ? stopCreating : undefined}
          onSaved={async (created) => {
            await reloadSites();
            selectSite(created.id);
            stopCreating();
            toast(`Sitio ${created.name} creado. Ahora pegá el snippet.`);
          }}
        />
      )}

      {!site && !creating && (
        <EmptyState title="Todavía no hay sitios">
          Un dueño de tu equipo tiene que agregar el primer sitio. Cuando lo haga, lo vas a ver acá con su snippet.
        </EmptyState>
      )}

      {site && !creating && (
        <>
          <Panel title={`Snippet para ${site.name}`} actions={<CopyButton text={snippet} />}>
            <Code>{snippet}</Code>
            <p className="mt-3 text-[13px] text-ink-2">
              Sólo acepta eventos enviados desde <strong className="font-medium text-ink">{site.domain}</strong> y sus subdominios.
              El script respeta la opción “No rastrear” del navegador y pesa menos de 10 kB.
            </p>
          </Panel>

          {isOwner && <SiteForm key={site.id} site={site} title="Datos del sitio" onSaved={reloadSites} />}

          <InstallStatus siteId={site.id} />

          <Panel
            title="Eventos que se registran solos"
            description="Podés apagar cualquiera, cambiar los cortes de scroll y crear eventos sin código desde Captura de datos."
            actions={<Link to="/captura" className="rounded-lg px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-surface-2">Configurar</Link>}
          >
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              {AUTO_EVENTS.map(([name, text]) => (
                <div key={name} className="contents">
                  <dt><code className="text-[13px]">{name}</code></dt>
                  <dd className="text-ink-2">{text}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Eventos propios con atributos HTML" description="Sin escribir JavaScript. Cada atributo data-track-* se guarda como propiedad del evento." actions={<CopyButton text={declarative} />}>
            <Code>{declarative}</Code>
            <p className="mt-3 text-[13px] text-ink-2">
              El primer link genera <code>whatsapp_click</code> con la propiedad <code>location = header</code>.
              En el constructor la vas a encontrar como <code>location</code> para filtrar o separar resultados.
              <code> data-track-button-color</code> se guarda como <code>button_color</code>.
            </p>
          </Panel>

          <Panel title="Eventos propios desde JavaScript" actions={<CopyButton text={programmatic} />}>
            <Code>{programmatic}</Code>
            <p className="mt-3 text-[13px] text-ink-2">
              Si tu código puede llamar a <code>analytics.track</code> antes de que cargue el script, agregá este fragmento antes del snippet:
            </p>
            <div className="mt-2"><Code>{stub}</Code></div>
          </Panel>

          {site.domain === "localhost" && (
            <Panel title="Probar sin un sitio real">
              <p className="text-sm text-ink-2">
                Este sitio usa el dominio localhost: podés generar eventos con la página de prueba y verlos en Eventos en vivo.
              </p>
              <a
                className="mt-2 inline-block text-sm font-medium text-accent underline-offset-2 hover:underline"
                href={`${BACKEND_URL}/static/demo.html?api_key=${site.api_key}`}
                target="_blank"
                rel="noreferrer"
              >
                Abrir la página de prueba
              </a>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function Code({ children }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-plane p-4 text-[13px] leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

const COMMON_TIMEZONES = [
  "America/Argentina/Buenos_Aires", "America/Montevideo", "America/Santiago", "America/Sao_Paulo",
  "America/Bogota", "America/Lima", "America/Mexico_City", "America/New_York", "Europe/Madrid", "UTC",
];

/**
 * Alta o edición de un sitio. En el alta, `clientId` fija el cliente; si no viene y el usuario
 * puede crear en más de un cliente (la plataforma, o dueño de varios), se elige de una lista.
 */
export function SiteForm({ site, title, onSaved, onCancel, clientId }) {
  const { isPlatformAdmin, ownedClients } = useApp();
  const needsClient = !site && !clientId && (isPlatformAdmin || ownedClients.length > 1);
  const clients = useAsync(
    (signal) => api.get("clients/", undefined, { signal }),
    [],
    { enabled: needsClient }
  );
  const choices = (clients.data || [])
    .filter((c) => c.is_active && c.role === "owner")
    .map((c) => ({ id: c.id, name: c.name }));
  const [chosenClient, setChosenClient] = useState("");
  const [values, setValues] = useState({
    name: site?.name || "",
    domain: site?.domain || "",
    timezone: site?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Argentina/Buenos_Aires",
  });
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const timezones = COMMON_TIMEZONES.includes(values.timezone) ? COMMON_TIMEZONES : [values.timezone, ...COMMON_TIMEZONES];

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setStatus("saving");
    try {
      const client_id = clientId || (needsClient ? chosenClient : undefined);
      const saved = site ? await api.patch(`sites/${site.id}/`, values) : await api.post("sites/", { ...values, client_id });
      setStatus("saved");
      await onSaved(saved);
    } catch (err) {
      setError(err);
      setStatus(null);
    }
  };

  return (
    <Panel title={title}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        {needsClient && (
          <Field label="Cliente" className="sm:col-span-3" hint="El sitio y sus datos van a ser de este cliente. No se puede cambiar después.">
            <select required value={chosenClient} onChange={(e) => setChosenClient(e.target.value)} className="w-full sm:w-80">
              <option value="" disabled>{clients.data ? "Elegí un cliente" : "Cargando clientes…"}</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Nombre">
          <input required maxLength={100} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} className="w-full" placeholder="Mi tienda" />
        </Field>
        <Field label="Dominio" hint="Sin https://. Usá localhost para probar.">
          <input required value={values.domain} onChange={(e) => setValues({ ...values, domain: e.target.value })} className="w-full" placeholder="mitienda.com" />
        </Field>
        <Field label="Zona horaria" hint="Define dónde empieza cada día en los reportes.">
          <select value={values.timezone} onChange={(e) => setValues({ ...values, timezone: e.target.value })} className="w-full">
            {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>
        {error && <div className="sm:col-span-3"><ErrorNote error={error} /></div>}
        <div className="flex items-center gap-2 sm:col-span-3">
          <Button type="submit" variant="primary" disabled={status === "saving"}>{site ? "Guardar cambios" : "Crear sitio"}</Button>
          {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
          {status === "saved" && site && <span className="text-[13px] text-good">Cambios guardados</span>}
        </div>
      </form>
    </Panel>
  );
}

/** Estado de la instalación: si llegan eventos y hace cuánto llegó el último. */
function InstallStatus({ siteId }) {
  const setup = useAsync((signal) => api.get(`sites/${siteId}/setup/`, undefined, { signal }), [siteId]);
  const data = setup.data;
  if (!data) return null;
  const states = {
    ok: { tone: "bg-good", title: "Instalado y recibiendo datos", text: `${data.events_24h.toLocaleString("es-AR")} eventos en las últimas 24 horas.` },
    stale: { tone: "bg-bad", title: "Dejaron de llegar datos", text: "Hubo eventos, pero ninguno en las últimas 24 horas. Revisá que el snippet siga en la web." },
    waiting: { tone: "bg-accent-fill", title: "Esperando la primera visita", text: "Pegá el snippet y abrí tu web: este estado cambia solo." },
  };
  const state = states[data.health];
  return (
    <div role="status" className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          {data.health !== "stale" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${state.tone}`} />}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${state.tone}`} />
        </span>
        <div>
          <p className="text-sm font-medium">{state.title}</p>
          <p className="text-[13px] text-muted">{state.text}</p>
        </div>
      </div>
      <Button size="sm" onClick={setup.reload}>Verificar de nuevo</Button>
    </div>
  );
}
