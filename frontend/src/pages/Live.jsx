import { useEffect, useRef, useState } from "react";

import { EventSelect } from "../builder/Pickers";
import { Button, EmptyState, ErrorNote, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useApp } from "../state/AppContext";

const POLL_MS = 10000;
const MAX_ROWS = 300;

export default function Live() {
  const { site } = useApp();
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [paused, setPaused] = useState(false);
  const [eventName, setEventName] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [lastPoll, setLastPoll] = useState(null);
  const lastId = useRef(null);

  useEffect(() => {
    setEvents([]);
    lastId.current = null;
  }, [site.id, eventName]);

  useEffect(() => {
    if (paused) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const { events: fresh } = await api.get("events/recent/", {
          site_id: site.id, event_name: eventName, after_id: lastId.current, limit: 100,
        });
        if (cancelled) return;
        if (fresh.length) {
          // Sólo se resaltan los que llegan después de la primera carga.
          const highlight = lastId.current !== null;
          lastId.current = fresh[0].id;
          setEvents((current) => [...fresh.map((e) => ({ ...e, fresh: highlight })), ...current.map((e) => ({ ...e, fresh: false }))].slice(0, MAX_ROWS));
        }
        setError(null);
        setLastPoll(new Date());
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [site.id, eventName, paused]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Eventos en vivo"
        description="Los últimos eventos recibidos, actualizados cada 10 segundos. Usalo para verificar la instalación."
        actions={
          <>
            <div className="w-56">
              <EventSelect siteId={site.id} value={eventName} onChange={setEventName} placeholder="Todos los eventos" />
            </div>
            <Button onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
              {paused ? "Reanudar" : "Pausar"}
            </Button>
          </>
        }
      />

      <p className="flex items-center gap-2 text-[13px] text-muted" aria-live="polite">
        {!paused && lastPoll && (
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-fill opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-fill" />
          </span>
        )}
        {paused ? "En pausa." : lastPoll ? `Última actualización: ${lastPoll.toLocaleTimeString("es-AR")}` : "Conectando…"}
      </p>
      {error && <ErrorNote error={error} />}

      {events.length === 0 && lastPoll && (
        <EmptyState title="Todavía no llegó ningún evento">
          Abrí tu sitio con el snippet instalado (o la página de prueba de la sección Instalación) y los eventos van a aparecer acá.
        </EmptyState>
      )}

      {events.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-surface-2 text-left text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Hora</th>
                <th scope="col" className="px-3 py-2 font-medium">Evento</th>
                <th scope="col" className="px-3 py-2 font-medium">Página</th>
                <th scope="col" className="px-3 py-2 font-medium">Origen</th>
                <th scope="col" className="px-3 py-2 font-medium">Dispositivo</th>
                <th scope="col" className="px-3 py-2 font-medium">Visitante</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  timeZone={site.timezone}
                  open={expanded === event.id}
                  onToggle={() => setExpanded((current) => (current === event.id ? null : event.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EventRow({ event, timeZone, open, onToggle }) {
  const properties = Object.keys(event.properties || {}).length;
  return (
    <>
      <tr
        className={`cursor-pointer border-t border-line hover:bg-surface-2 ${event.fresh ? "bg-accent-wash/60" : ""}`}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
        tabIndex={0}
        aria-expanded={open}
      >
        <td className="whitespace-nowrap px-3 py-1.5 tabular text-ink-2">{formatDateTime(event.timestamp, timeZone)}</td>
        <td className="px-3 py-1.5 font-medium">
          {event.event_name}
          {properties > 0 && <span className="ml-1.5 font-normal text-muted">+{properties}</span>}
        </td>
        <td className="max-w-64 truncate px-3 py-1.5">{event.page || "—"}</td>
        <td className="px-3 py-1.5 text-ink-2">{event.utm_source || event.referrer || "directo"}</td>
        <td className="px-3 py-1.5 text-ink-2">{event.device_type}{event.country ? `, ${event.country}` : ""}</td>
        <td className="px-3 py-1.5 font-mono text-xs text-muted">{event.visitor_id.slice(0, 8)}</td>
      </tr>
      {open && (
        <tr className="bg-plane">
          <td colSpan={6} className="px-3 py-2">
            <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted">Sesión</dt><dd className="font-mono text-xs">{event.session_id}</dd>
              <dt className="text-muted">Visitante</dt><dd className="font-mono text-xs">{event.visitor_id}</dd>
              <dt className="text-muted">Campaña</dt><dd>{event.utm_campaign || "—"}</dd>
              <dt className="text-muted">Recibido</dt><dd>{formatDateTime(event.received_at, timeZone)}</dd>
              <dt className="text-muted">Propiedades</dt>
              <dd><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(event.properties, null, 2)}</pre></dd>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
