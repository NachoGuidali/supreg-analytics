import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { Sparkline } from "../charts/TrendChart";
import { BillingPill, PERIOD_MONTHS, addMonths, formatDate, needsAttention, todayIso } from "../components/Billing";
import { PlusIcon } from "../components/icons";
import {
  Button, CopyButton, EmptyState, ErrorNote, Field, Initials, InitialPasswordInput, Modal, PageHeader, Panel,
  Segmented, StatusPill, Table, generatePassword,
} from "../components/ui";
import { api } from "../lib/api";
import { formatExact, formatNumber } from "../lib/format";
import { useAsync } from "../lib/hooks";

const ACTIVITY_DAYS = 14;
const createdFormat = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });

function plural(n, one, many) {
  return `${formatExact(n)} ${n === 1 ? one : many}`;
}

export default function Clients() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const clients = useAsync((signal) => api.get("clients/", undefined, { signal }), []);
  const activity = useAsync((signal) => api.get("clients/activity/", { days: ACTIVITY_DAYS }, { signal }), []);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  const [justAdded, setJustAdded] = useState(state?.highlight || null);

  const list = clients.data || [];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchStatus = (c) => ({
      all: true,
      active: c.is_active,
      suspended: !c.is_active,
      expiring: c.billing.status === "expiring",
      overdue: ["overdue", "blocked"].includes(c.billing.status),
    })[status];
    return list.filter((c) => matchStatus(c) && (!q || `${c.name} ${c.notes || ""}`.toLowerCase().includes(q)));
  }, [list, query, status]);
  const expiring = list.filter((c) => c.billing.status === "expiring").length;
  const overdue = list.filter((c) => ["overdue", "blocked"].includes(c.billing.status)).length;

  const suspended = list.filter((c) => !c.is_active).length;
  const totalSites = list.reduce((sum, c) => sum + c.site_count, 0);
  const summary = clients.data
    ? `${plural(list.length - suspended, "cliente activo", "clientes activos")}${suspended ? ` y ${plural(suspended, "suspendido", "suspendidos")}` : ""}, con ${plural(totalSites, "sitio", "sitios")} en total.${
        expiring || overdue ? ` ${[expiring && plural(expiring, "vence esta semana", "vencen esta semana"), overdue && plural(overdue, "vencido", "vencidos")].filter(Boolean).join(" y ")}.` : ""}`
    : "Cargando clientes…";

  const columns = [
    {
      key: "name", label: "Cliente",
      render: (c) => (
        <span className="flex items-center gap-3">
          <Initials text={c.name} size={34} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{c.name}</span>
            {c.notes && <span className="block max-w-[32ch] truncate text-[13px] text-muted">{c.notes}</span>}
          </span>
        </span>
      ),
    },
    {
      key: "activity", label: `Sesiones, últimos ${ACTIVITY_DAYS} días`, className: "hidden md:table-cell",
      render: (c) => {
        const series = activity.data?.series[c.id] || Array(ACTIVITY_DAYS).fill(0);
        const total = series.reduce((a, b) => a + b, 0);
        return (
          <span className="flex items-center gap-3" title={`${formatExact(total)} sesiones en ${ACTIVITY_DAYS} días`}>
            <span className="w-28">{activity.data ? <Sparkline values={series} height={28} /> : <span className="block h-7" />}</span>
            <span className="tabular w-12 text-right text-ink-2">{activity.data ? formatNumber(total) : ""}</span>
          </span>
        );
      },
    },
    {
      key: "plan", label: "Plan y vencimiento",
      render: (c) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink">{c.plan?.name || <span className="text-muted">Sin plan</span>}</span>
          <span title={c.paid_until ? `Vence el ${formatDate(c.paid_until)}` : undefined}><BillingPill billing={c.billing} short /></span>
        </span>
      ),
    },
    { key: "site_count", label: "Sitios", numeric: true },
    { key: "member_count", label: "Personas", numeric: true, className: "hidden sm:table-cell" },
    { key: "is_active", label: "Estado", render: (c) => <StatusPill active={c.is_active} /> },
    {
      key: "created_at", label: "Alta", className: "hidden lg:table-cell whitespace-nowrap text-muted",
      render: (c) => createdFormat.format(new Date(c.created_at)),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clientes"
        description={summary}
        actions={<Button variant="primary" onClick={() => setCreating(true)}><PlusIcon /> Nuevo cliente</Button>}
      />
      {clients.error && <ErrorNote error={clients.error} />}

      {clients.data && list.length === 0 ? (
        <EmptyState title="Todavía no hay clientes" action={<Button variant="primary" onClick={() => setCreating(true)}>Dar de alta el primero</Button>}>
          Cada cliente tiene sus propios sitios y su equipo, y sólo ve sus datos. Al darlo de alta le creás el usuario a su dueño.
        </EmptyState>
      ) : (
        <Panel bodyClassName="">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o nota"
              aria-label="Buscar clientes"
              className="w-full max-w-72"
            />
            <Segmented
              label="Estado"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "Todos" },
                { value: "expiring", label: `Por vencer${expiring ? ` (${expiring})` : ""}` },
                { value: "overdue", label: `Vencidos${overdue ? ` (${overdue})` : ""}` },
                { value: "active", label: "Activos" },
                { value: "suspended", label: "Suspendidos" },
              ]}
            />
          </div>
          <Table
            columns={columns}
            rows={visible}
            rowKey={(c) => c.id}
            highlight={justAdded}
            onRowClick={(c) => navigate(`/plataforma/clientes/${c.id}`)}
            rowClassName={(c) => (needsAttention(c.billing) ? "bg-warn-wash/40" : "")}
            empty={clients.data ? "Ningún cliente coincide con la búsqueda." : "Cargando…"}
          />
        </Panel>
      )}

      {creating && (
        <NewClientDialog
          onClose={() => setCreating(false)}
          onCreated={(client) => {
            clients.reload();
            // Sin toast: el diálogo de entrega ya confirma el alta.
            setJustAdded(client.id);
          }}
        />
      )}
    </div>
  );
}

function NewClientDialog({ onClose, onCreated }) {
  const plans = useAsync((signal) => api.get("plans/", undefined, { signal }), []);
  const offered = (plans.data || []).filter((p) => p.is_active);
  const [values, setValues] = useState({ name: "", notes: "", email: "", first_name: "", password: generatePassword(), plan_id: "", paid_until: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const set = (key) => (e) => setValues({ ...values, [key]: e.target?.value ?? e });

  if (created) {
    const loginUrl = window.location.origin;
    const handoff = `Ya tenés acceso a ${document.title}.\n\nIngresá en ${loginUrl}\nUsuario: ${values.email.trim().toLowerCase()}\nContraseña: ${values.password}\n\nTe recomendamos cambiar la contraseña desde “Mi cuenta” la primera vez que entres.`;
    return (
      <Modal title={`${created.name} ya está listo`} onClose={onClose} wide>
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            Mandale estos datos a {values.first_name.trim() || values.email.trim()}. La contraseña no se vuelve a mostrar.
            Si el email ya tenía usuario, entra con su contraseña de siempre.
          </p>
          <pre className="whitespace-pre-wrap rounded-lg border border-line bg-plane p-4 font-sans text-sm leading-relaxed">{handoff}</pre>
          <div className="flex justify-end gap-2">
            <CopyButton text={handoff} label="Copiar mensaje" />
            <Button variant="primary" onClick={onClose}>Listo</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Nuevo cliente" onClose={onClose} wide>
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const client = await api.post("clients/", {
              name: values.name.trim(),
              notes: values.notes.trim(),
              plan_id: values.plan_id ? Number(values.plan_id) : null,
              paid_until: values.paid_until || null,
              owner: { email: values.email.trim(), first_name: values.first_name.trim(), password: values.password },
            });
            setCreated(client);
            onCreated(client);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="grid gap-3">
          <Field label="Nombre del cliente">
            <input autoFocus required maxLength={150} value={values.name} onChange={set("name")} className="w-full" placeholder="Ferretería Don Luis" />
          </Field>
          <Field label="Notas internas (opcional)" hint="Sólo las ve la plataforma: plan, contacto, vencimientos.">
            <textarea rows={2} value={values.notes} onChange={set("notes")} className="w-full" />
          </Field>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan" hint={offered.length ? undefined : "Creá planes en Plataforma → Planes."}>
            <select value={values.plan_id} className="w-full" onChange={(e) => {
              const plan = offered.find((p) => String(p.id) === e.target.value);
              // Al elegir un plan, el vencimiento arranca en un período desde hoy (editable).
              setValues({ ...values, plan_id: e.target.value, paid_until: plan ? addMonths(todayIso(), PERIOD_MONTHS[plan.period]) : values.paid_until });
            }}>
              <option value="">Sin plan (sin límites)</option>
              {offered.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Vence" hint="Vacío = no vence.">
            <input type="date" value={values.paid_until} onChange={set("paid_until")} className="w-full" />
          </Field>
        </div>
        <fieldset className="space-y-3 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-medium">Dueño de la cuenta</legend>
          <p className="text-[13px] text-muted">Va a poder agregar sitios y sumar a su equipo.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email">
              <input required type="email" value={values.email} onChange={set("email")} className="w-full" placeholder="luis@ferreteria.com" />
            </Field>
            <Field label="Nombre (opcional)">
              <input maxLength={150} value={values.first_name} onChange={set("first_name")} className="w-full" placeholder="Luis" />
            </Field>
          </div>
          <Field label="Contraseña inicial" hint="Mínimo 8 caracteres. Se la vas a poder copiar en el paso siguiente.">
            <InitialPasswordInput value={values.password} onChange={set("password")} />
          </Field>
        </fieldset>
        {error && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Creando…" : "Crear cliente"}</Button>
        </div>
      </form>
    </Modal>
  );
}
