import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  BillingPill, PERIOD_MONTHS, PERIODS, billingText, formatDate, formatMoney, needsAttention, nextPaidUntil, todayIso,
} from "../components/Billing";
import { PlusIcon } from "../components/icons";
import TeamManager from "../components/TeamManager";
import { Button, ErrorNote, Field, Initials, Modal, Panel, StatusPill, Table, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { formatExact } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useApp } from "../state/AppContext";
import { useToast } from "../state/Toasts";
import { SiteForm } from "./Install";

export default function ClientDetail() {
  const { id } = useParams();
  const client = useAsync((signal) => api.get(`clients/${id}/`, undefined, { signal }), [id]);
  const [tab, setTab] = useState("sites");
  const [confirming, setConfirming] = useState(false);

  if (client.error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorNote error={client.error} />
      </div>
    );
  }
  if (!client.data) return <p className="text-sm text-muted">Cargando cliente…</p>;
  const c = client.data;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink />
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Initials text={c.name} size={52} />
            <div className="min-w-0">
              <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight">{c.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                <StatusPill active={c.is_active} />
                <span className="text-[13px] text-muted">{c.plan?.name || "Sin plan"}</span>
                <BillingPill billing={c.billing} />
              </div>
            </div>
          </div>
          <Button variant={c.is_active ? "danger" : "primary"} onClick={() => setConfirming(true)}>
            {c.is_active ? "Suspender cliente" : "Reactivar cliente"}
          </Button>
        </header>
      </div>

      {!c.is_active && (
        <div role="status" className="rounded-xl border border-line bg-warn-wash px-4 py-3 text-sm">
          Cliente suspendido: su equipo no puede entrar y sus sitios no registran visitas. Los datos se conservan.
        </div>
      )}

      <Tabs
        label="Secciones del cliente"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "sites", label: "Sitios", count: c.site_count },
          { value: "team", label: "Equipo", count: c.member_count },
          { value: "billing", label: needsAttention(c.billing) ? "Plan y pagos ●" : "Plan y pagos" },
          { value: "settings", label: "Datos" },
        ]}
      />

      {tab === "sites" && <ClientSites client={c} onChange={client.reload} />}
      {tab === "team" && <TeamManager clientId={c.id} clientName={c.name} canManage />}
      {tab === "billing" && <ClientBilling client={c} onChange={client.reload} />}
      {tab === "settings" && <ClientSettings client={c} onSaved={client.reload} />}

      {confirming && <ToggleActiveDialog client={c} onClose={() => setConfirming(false)} onDone={client.reload} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/plataforma/clientes" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
      <span aria-hidden="true">‹</span> Clientes
    </Link>
  );
}

function ClientSites({ client, onChange }) {
  const { selectSite, reloadSites } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const sites = useAsync((signal) => api.get("sites/", { client_id: client.id }, { signal }), [client.id]);
  const [creating, setCreating] = useState(false);
  const [justAdded, setJustAdded] = useState(null);

  const open = async (site, path = "/") => {
    await reloadSites();
    selectSite(site.id);
    navigate(path);
  };

  return (
    <div className="space-y-4">
      {creating && (
        <SiteForm
          title={`Nuevo sitio para ${client.name}`}
          clientId={client.id}
          onCancel={() => setCreating(false)}
          onSaved={async (created) => {
            setCreating(false);
            setJustAdded(created.id);
            sites.reload();
            onChange();
            await reloadSites();
            toast(`Sitio ${created.name} creado`);
          }}
        />
      )}
      <Panel
        title="Sitios"
        description="Cada sitio tiene su propio snippet y sus propios datos."
        actions={!creating && <Button size="sm" variant="primary" onClick={() => setCreating(true)}><PlusIcon /> Agregar sitio</Button>}
        bodyClassName="pt-2"
      >
        {sites.error && <div className="px-5"><ErrorNote error={sites.error} /></div>}
        <Table
          rows={sites.data || []}
          rowKey={(s) => s.id}
          highlight={justAdded}
          empty={sites.data ? "Este cliente todavía no tiene sitios. Agregá el primero para obtener su snippet." : "Cargando…"}
          columns={[
            { key: "name", label: "Sitio", render: (s) => <span className="font-medium text-ink">{s.name}</span> },
            { key: "domain", label: "Dominio", className: "text-ink-2" },
            { key: "timezone", label: "Zona horaria", className: "hidden md:table-cell text-muted" },
            {
              key: "actions", label: <span className="sr-only">Acciones</span>, className: "text-right whitespace-nowrap",
              render: (s) => (
                <span className="inline-flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => open(s, "/instalacion")}>Snippet</Button>
                  <Button size="sm" onClick={() => open(s)}>Ver analítica</Button>
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}

function ClientSettings({ client, onSaved }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [values, setValues] = useState({ name: client.name, notes: client.notes || "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!window.confirm(`¿Borrar ${client.name}? Se quitan también los accesos de su equipo.`)) return;
    try {
      await api.delete(`clients/${client.id}/`);
      toast(`Cliente ${client.name} borrado`);
      navigate("/plataforma/clientes");
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <Panel title="Datos del cliente">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api.patch(`clients/${client.id}/`, { name: values.name.trim(), notes: values.notes.trim() });
              toast("Cambios guardados");
              onSaved();
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Nombre">
            <input required maxLength={150} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} className="w-full" />
          </Field>
          <Field label="Notas internas" hint="Sólo las ve la plataforma.">
            <textarea rows={4} value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} className="w-full" />
          </Field>
          {error && <ErrorNote error={error} />}
          <Button type="submit" variant="primary" disabled={busy}>Guardar cambios</Button>
        </form>
      </Panel>

      <Panel title="Borrar cliente">
        {client.site_count > 0 ? (
          <p className="text-sm text-ink-2">
            No se puede borrar un cliente con sitios, porque se perderían sus visitas. Suspendelo para cortarle el acceso,
            o borrá sus sitios desde el admin de Django primero.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2">No tiene sitios. Borrarlo quita también los accesos de su equipo.</p>
            <Button variant="danger" onClick={remove}>Borrar cliente</Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ToggleActiveDialog({ client, onClose, onDone }) {
  const toast = useToast();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const suspending = client.is_active;
  return (
    <Modal title={suspending ? `¿Suspender ${client.name}?` : `¿Reactivar ${client.name}?`} onClose={onClose}>
      <div className="space-y-4">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          {suspending ? (
            <>
              <li>Su equipo no va a poder entrar al dashboard.</li>
              <li>Sus sitios dejan de registrar visitas mientras dure la suspensión.</li>
              <li>Los datos que ya tiene se conservan.</li>
            </>
          ) : (
            <>
              <li>Su equipo vuelve a entrar con sus usuarios de siempre.</li>
              <li>Sus sitios vuelven a registrar visitas desde ahora. Lo que pasó durante la suspensión no se recupera.</li>
            </>
          )}
        </ul>
        {error && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant={suspending ? "danger" : "primary"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.patch(`clients/${client.id}/`, { is_active: !suspending });
                toast(suspending ? `${client.name} quedó suspendido` : `${client.name} está activo de nuevo`);
                onDone();
                onClose();
              } catch (err) {
                setError(err);
                setBusy(false);
              }
            }}
          >
            {suspending ? "Suspender" : "Reactivar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const METHODS = { transfer: "Transferencia", mercadopago: "Mercado Pago", cash: "Efectivo", other: "Otro" };

function UsageBar({ label, value, limit, format = formatExact }) {
  const percent = limit ? Math.min(100, (value / limit) * 100) : 0;
  const over = limit && value > limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink-2">{label}</span>
        <span className="tabular"><span className={`font-medium ${over ? "text-bad" : ""}`}>{format(value)}</span>
          <span className="text-muted"> / {limit ? format(limit) : "sin límite"}</span></span>
      </div>
      {limit ? (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <span className={`block h-full rounded-full ${over ? "bg-bad" : "bg-[var(--chart-accent)]"}`} style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {over && <p className="mt-1 text-[13px] text-bad">Se pasó del plan: conviene ofrecerle uno más grande.</p>}
    </div>
  );
}

function ClientBilling({ client, onChange }) {
  const toast = useToast();
  const plans = useAsync((signal) => api.get("plans/", undefined, { signal }), []);
  const payments = useAsync((signal) => api.get(`clients/${client.id}/payments/`, undefined, { signal }), [client.id]);
  const [values, setValues] = useState({ plan_id: client.plan_id ?? "", paid_until: client.paid_until || "" });
  const [error, setError] = useState(null);
  const [paying, setPaying] = useState(false);
  const dirty = String(values.plan_id) !== String(client.plan_id ?? "") || values.paid_until !== (client.paid_until || "");
  const choices = (plans.data || []).filter((p) => p.is_active || p.id === client.plan_id);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.patch(`clients/${client.id}/`, { plan_id: values.plan_id ? Number(values.plan_id) : null, paid_until: values.paid_until || null });
      toast("Plan actualizado");
      onChange();
    } catch (err) {
      setError(err);
    }
  };
  const removePayment = async (payment) => {
    if (!window.confirm("¿Borrar este pago del historial? El vencimiento no cambia.")) return;
    await api.delete(`clients/${client.id}/payments/${payment.id}/`);
    payments.reload();
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Plan" description={billingText(client.billing)}>
          <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Plan">
                <select value={values.plan_id} onChange={(e) => setValues({ ...values, plan_id: e.target.value })} className="w-full">
                  <option value="">Sin plan (sin límites)</option>
                  {choices.map((p) => <option key={p.id} value={p.id}>{p.name} ({formatMoney(p.price, p.currency)} {PERIODS[p.period]})</option>)}
                </select>
              </Field>
              <Field label="Vence" hint="Vacío = no vence.">
                <input type="date" value={values.paid_until} onChange={(e) => setValues({ ...values, paid_until: e.target.value })} className="w-full" />
              </Field>
            </div>
            {error && <ErrorNote error={error} />}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" disabled={!dirty}>Guardar</Button>
              <Button onClick={() => setPaying(true)}>Registrar pago</Button>
            </div>
          </form>
        </Panel>
        <Panel title="Uso" description="Comparado con lo que incluye el plan">
          {client.usage ? (
            <div className="space-y-4 pt-1">
              <UsageBar label="Sitios" value={client.usage.sites} limit={client.plan?.max_sites} />
              <UsageBar label="Eventos este mes" value={client.usage.events_month} limit={client.plan?.monthly_events} />
            </div>
          ) : <p className="text-sm text-muted">Cargando…</p>}
        </Panel>
      </div>

      <Panel title="Pagos" description="Historial de pagos registrados" bodyClassName="pt-2"
        actions={<Button size="sm" variant="primary" onClick={() => setPaying(true)}><PlusIcon /> Registrar pago</Button>}>
        {payments.error && <div className="px-5"><ErrorNote error={payments.error} /></div>}
        <Table
          rows={payments.data || []}
          rowKey={(p) => p.id}
          empty={payments.data ? "Todavía no hay pagos registrados." : "Cargando…"}
          columns={[
            { key: "paid_at", label: "Fecha", className: "whitespace-nowrap", render: (p) => formatDate(p.paid_at) },
            { key: "amount", label: "Monto", numeric: true, render: (p) => <span className="font-medium">{formatMoney(p.amount, p.currency)}</span> },
            { key: "method", label: "Medio", className: "hidden sm:table-cell", render: (p) => METHODS[p.method] || p.method },
            { key: "plan_name", label: "Plan", className: "hidden md:table-cell text-ink-2", render: (p) => p.plan_name || "—" },
            { key: "covers_until", label: "Cubre hasta", className: "whitespace-nowrap", render: (p) => formatDate(p.covers_until) },
            { key: "reference", label: "Referencia", className: "hidden lg:table-cell text-muted", render: (p) => [p.reference, p.notes].filter(Boolean).join(" — ") || "—" },
            { key: "actions", label: <span className="sr-only">Acciones</span>, className: "text-right", render: (p) => <Button size="sm" variant="ghost" onClick={() => removePayment(p)}>Borrar</Button> },
          ]}
        />
      </Panel>

      {paying && (
        <PaymentDialog
          client={client}
          onClose={() => setPaying(false)}
          onSaved={(payment) => {
            setPaying(false);
            payments.reload();
            onChange();
            toast(payment.covers_until ? `Pago registrado. Vence el ${formatDate(payment.covers_until)}` : "Pago registrado");
          }}
        />
      )}
    </div>
  );
}

function PaymentDialog({ client, onClose, onSaved }) {
  const plan = client.plan;
  const [values, setValues] = useState({
    amount: plan ? plan.price : "", currency: plan?.currency || "ARS", paid_at: todayIso(), method: "transfer",
    reference: "", notes: "", extend_periods: 1,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setValues({ ...values, [key]: e.target.value });
  const months = (plan ? PERIOD_MONTHS[plan.period] : 1) * Number(values.extend_periods || 0);
  const preview = months ? nextPaidUntil(client.paid_until, months) : client.paid_until;

  return (
    <Modal title={`Registrar pago de ${client.name}`} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onSaved(await api.post(`clients/${client.id}/payments/`, { ...values, extend_periods: Number(values.extend_periods || 0) }));
        } catch (err) {
          setError(err);
          setBusy(false);
        }
      }}>
        <div className="grid gap-3 sm:grid-cols-[1fr_100px_1fr]">
          <Field label="Monto"><input autoFocus required type="number" min={0} step="0.01" value={values.amount} onChange={set("amount")} className="w-full tabular" /></Field>
          <Field label="Moneda"><input required maxLength={3} value={values.currency} onChange={set("currency")} className="w-full uppercase" /></Field>
          <Field label="Fecha de pago"><input required type="date" value={values.paid_at} onChange={set("paid_at")} className="w-full" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Medio">
            <select value={values.method} onChange={set("method")} className="w-full">
              {Object.entries(METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Referencia (opcional)"><input maxLength={120} value={values.reference} onChange={set("reference")} className="w-full" placeholder="Nro. de operación" /></Field>
        </div>
        <Field label={`Extender el vencimiento (períodos ${plan ? (plan.period === "yearly" ? "anuales" : "mensuales") : "mensuales"})`}
          hint="0 = sólo anotar el pago, sin cambiar la fecha.">
          <input type="number" min={0} max={36} value={values.extend_periods} onChange={set("extend_periods")} className="w-28" />
        </Field>
        <p className="rounded-xl bg-surface-2/70 px-4 py-3 text-sm">
          {months
            ? <>Vencimiento: <span className="text-muted">{formatDate(client.paid_until)}</span> pasa a <strong>{formatDate(preview)}</strong>.</>
            : <>El vencimiento queda en {formatDate(client.paid_until)}.</>}
        </p>
        <Field label="Notas (opcional)"><input maxLength={300} value={values.notes} onChange={set("notes")} className="w-full" /></Field>
        {error && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>Registrar pago</Button>
        </div>
      </form>
    </Modal>
  );
}
