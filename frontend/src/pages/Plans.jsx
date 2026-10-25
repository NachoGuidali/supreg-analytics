import { useState } from "react";

import { formatMoney, PERIODS } from "../components/Billing";
import { PlusIcon } from "../components/icons";
import { Button, EmptyState, ErrorNote, Field, Modal, PageHeader, Panel, Segmented, StatusPill, Switch, Table } from "../components/ui";
import { api } from "../lib/api";
import { formatNumber } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useToast } from "../state/Toasts";

export default function Plans() {
  const toast = useToast();
  const plans = useAsync((signal) => api.get("plans/", undefined, { signal }), []);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);

  const remove = async (plan) => {
    if (!window.confirm(`¿Borrar el plan «${plan.name}»?`)) return;
    setError(null);
    try {
      await api.delete(`plans/${plan.id}/`);
      plans.reload();
      toast(`Plan «${plan.name}» borrado`);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planes"
        description="Lo que ofrecés a tus clientes: precio, período y qué incluye. Se asignan desde la ficha de cada cliente."
        actions={<Button variant="primary" onClick={() => setEditing({})}><PlusIcon /> Nuevo plan</Button>}
      />
      {(error || plans.error) && <ErrorNote error={error || plans.error} />}
      {plans.data?.length === 0 ? (
        <EmptyState title="Todavía no hay planes" action={<Button variant="primary" onClick={() => setEditing({})}>Crear el primero</Button>}>
          Por ejemplo: Básico (1 sitio, mensual), Pro (5 sitios) y Agencia (sin límite). Los clientes sin plan no tienen límites ni vencimiento.
        </EmptyState>
      ) : (
        <Panel bodyClassName="pt-2">
          <Table
            rows={plans.data || []}
            rowKey={(p) => p.id}
            onRowClick={(p) => setEditing(p)}
            empty="Cargando…"
            columns={[
              {
                key: "name", label: "Plan",
                render: (p) => (
                  <span className="block max-w-[36ch]">
                    <span className="block font-medium">{p.name}</span>
                    {p.description && <span className="block truncate text-[13px] text-muted">{p.description}</span>}
                  </span>
                ),
              },
              {
                key: "price", label: "Precio", numeric: true,
                render: (p) => <span className="whitespace-nowrap"><span className="font-medium">{formatMoney(p.price, p.currency)}</span> <span className="text-[13px] text-muted">{PERIODS[p.period]}</span></span>,
              },
              { key: "max_sites", label: "Sitios", numeric: true, className: "hidden sm:table-cell", render: (p) => p.max_sites ?? "Sin límite" },
              { key: "monthly_events", label: "Eventos por mes", numeric: true, className: "hidden md:table-cell", render: (p) => (p.monthly_events ? formatNumber(p.monthly_events) : "Sin límite") },
              { key: "client_count", label: "Clientes", numeric: true },
              { key: "is_active", label: "Estado", className: "hidden sm:table-cell", render: (p) => (p.is_active ? <StatusPill active /> : <span className="text-[13px] text-muted">No se ofrece</span>) },
              {
                key: "actions", label: <span className="sr-only">Acciones</span>, className: "text-right",
                render: (p) => (
                  <span onClick={(e) => e.stopPropagation()} className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p)}>Borrar</Button>
                  </span>
                ),
              },
            ]}
          />
        </Panel>
      )}
      {editing && (
        <PlanDialog
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            plans.reload();
            toast(created ? `Plan «${saved.name}» creado` : "Cambios guardados");
          }}
        />
      )}
    </div>
  );
}

function PlanDialog({ plan, onClose, onSaved }) {
  const editing = Boolean(plan.id);
  const [values, setValues] = useState({
    name: plan.name || "", description: plan.description || "", price: plan.price ?? "", currency: plan.currency || "ARS",
    period: plan.period || "monthly", max_sites: plan.max_sites ?? "", monthly_events: plan.monthly_events ?? "",
    is_active: plan.is_active ?? true,
  });
  const [error, setError] = useState(null);
  const set = (key) => (e) => setValues({ ...values, [key]: e?.target ? e.target.value : e });

  return (
    <Modal title={editing ? `Editar ${plan.name}` : "Nuevo plan"} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const body = {
          ...values,
          max_sites: values.max_sites === "" ? null : Number(values.max_sites),
          monthly_events: values.monthly_events === "" ? null : Number(values.monthly_events),
        };
        try {
          onSaved(editing ? await api.patch(`plans/${plan.id}/`, body) : await api.post("plans/", body), !editing);
        } catch (err) {
          setError(err);
        }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre"><input autoFocus required maxLength={80} value={values.name} onChange={set("name")} className="w-full" placeholder="Pro" /></Field>
          <Field label="Período">
            <Segmented label="Período" value={values.period} onChange={set("period")} options={[{ value: "monthly", label: "Mensual" }, { value: "yearly", label: "Anual" }]} />
          </Field>
        </div>
        <Field label="Descripción (opcional)" hint="Para recordar qué incluye. No la ven los clientes.">
          <input maxLength={300} value={values.description} onChange={set("description")} className="w-full" placeholder="Hasta 5 webs, soporte por WhatsApp" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
          <Field label="Precio"><input required type="number" min={0} step="0.01" value={values.price} onChange={set("price")} className="w-full tabular" /></Field>
          <Field label="Moneda"><input required maxLength={3} value={values.currency} onChange={set("currency")} className="w-full uppercase" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sitios incluidos" hint="Vacío = sin límite. Los dueños no pueden agregar más."><input type="number" min={1} value={values.max_sites} onChange={set("max_sites")} className="w-full" /></Field>
          <Field label="Eventos por mes" hint="Referencia de uso: se muestra en la ficha del cliente."><input type="number" min={1} value={values.monthly_events} onChange={set("monthly_events")} className="w-full" /></Field>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line px-4 py-3">
          <span>
            <span className="block text-sm font-medium">Se ofrece</span>
            <span className="block text-[13px] text-muted">Apagado: no aparece para clientes nuevos; los que lo tienen lo conservan.</span>
          </span>
          <Switch checked={values.is_active} onChange={set("is_active")} label="Se ofrece" />
        </div>
        {error && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary">{editing ? "Guardar cambios" : "Crear plan"}</Button>
        </div>
      </form>
    </Modal>
  );
}
