import { useState } from "react";

import { BillingPill, formatDate } from "../components/Billing";
import { Button, ErrorNote, Field, Initials, PageHeader, Panel, RoleBadge } from "../components/ui";
import { api } from "../lib/api";
import { useApp } from "../state/AppContext";
import { useToast } from "../state/Toasts";

export default function Account() {
  const { user, isPlatformAdmin } = useApp();
  const name = user.first_name || user.email || user.username;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Mi cuenta" />
      <Panel>
        <div className="flex items-center gap-4 pt-2">
          <Initials text={name} size={48} />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold">{name}</p>
            <p className="truncate text-sm text-muted">{user.email || user.username}</p>
          </div>
        </div>
      </Panel>

      <Panel title="Tus accesos" description={isPlatformAdmin ? "Como administrador de la plataforma ves y gestionás todos los clientes." : "Clientes cuyos sitios podés ver, y con qué rol."}>
        {user.memberships.length === 0 ? (
          <p className="text-sm text-muted">No sos parte del equipo de ningún cliente.</p>
        ) : (
          <ul className="divide-y divide-line">
            {user.memberships.map((m) => (
              <li key={m.client_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{m.client_name}</span>
                  {m.billing && (
                    <span className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                      {m.billing.plan_name ? `Plan ${m.billing.plan_name}` : "Sin plan"}
                      {m.billing.paid_until && <span>vence el {formatDate(m.billing.paid_until)}</span>}
                      <BillingPill billing={m.billing} short />
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {m.billing?.renew_url && m.billing.status !== "none" && (
                    <a href={m.billing.renew_url} target="_blank" rel="noopener" className="rounded-lg px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-surface-2">Renovar</a>
                  )}
                  <RoleBadge role={m.role} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <PasswordForm />
    </div>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [values, setValues] = useState({ current_password: "", new_password: "", repeat: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const mismatch = values.repeat && values.repeat !== values.new_password;
  const set = (key) => (e) => setValues({ ...values, [key]: e.target.value });

  return (
    <Panel title="Cambiar contraseña">
      <form
        className="grid gap-3 sm:max-w-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          if (mismatch) return;
          setBusy(true);
          setError(null);
          try {
            await api.post("auth/password/", { current_password: values.current_password, new_password: values.new_password });
            setValues({ current_password: "", new_password: "", repeat: "" });
            toast("Contraseña cambiada");
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Contraseña actual">
          <input required type="password" autoComplete="current-password" value={values.current_password} onChange={set("current_password")} className="w-full" />
        </Field>
        <Field label="Contraseña nueva" hint="Mínimo 8 caracteres, que no sea sólo números ni muy común.">
          <input required minLength={8} type="password" autoComplete="new-password" value={values.new_password} onChange={set("new_password")} className="w-full" />
        </Field>
        <Field label="Repetí la contraseña nueva">
          <input required type="password" autoComplete="new-password" value={values.repeat} onChange={set("repeat")} className="w-full" aria-invalid={Boolean(mismatch)} />
        </Field>
        {mismatch && <p className="text-[13px] text-bad">Las contraseñas nuevas no coinciden.</p>}
        {error && <ErrorNote error={error} />}
        <div><Button type="submit" variant="primary" disabled={busy || mismatch}>Cambiar contraseña</Button></div>
      </form>
    </Panel>
  );
}
