import { useState } from "react";

import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useApp } from "../state/AppContext";
import { useToast } from "../state/Toasts";
import { PlusIcon } from "./icons";
import {
  Button, CopyButton, ErrorNote, Field, Initials, InitialPasswordInput, Modal, Panel, ROLES, RoleBadge, Table,
  generatePassword,
} from "./ui";

const relative = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });

function lastSeen(iso) {
  if (!iso) return "Nunca entró";
  const minutes = Math.round((new Date(iso) - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 45) return relative.format(days, "day");
  return relative.format(Math.round(days / 30), "month");
}

/** Equipo de un cliente: lista para todos los miembros, gestión para dueños y la plataforma. */
export default function TeamManager({ clientId, clientName, canManage }) {
  const { user, refreshUser } = useApp();
  const [resetting, setResetting] = useState(null);
  const toast = useToast();
  const members = useAsync((signal) => api.get(`clients/${clientId}/members/`, undefined, { signal }), [clientId]);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(null);
  const [error, setError] = useState(null);
  const isMe = (m) => m.username === user?.username;

  const changeRole = async (member, role) => {
    setError(null);
    try {
      await api.patch(`clients/${clientId}/members/${member.id}/`, { role });
      toast(`${member.first_name || member.email} ahora es ${ROLES[role].label.toLowerCase()}`);
      members.reload();
      if (isMe(member)) refreshUser();
    } catch (err) {
      setError(err);
    }
  };
  const remove = async (member) => {
    const who = member.first_name || member.email;
    if (!window.confirm(isMe(member) ? `¿Salir de ${clientName}? Vas a perder el acceso a sus sitios.` : `¿Quitar a ${who} de ${clientName}? Deja de ver sus sitios. Su usuario sigue existiendo.`)) return;
    setError(null);
    try {
      await api.delete(`clients/${clientId}/members/${member.id}/`);
      toast(isMe(member) ? `Saliste de ${clientName}` : `${who} ya no es parte del equipo`);
      members.reload();
      if (isMe(member)) refreshUser();
    } catch (err) {
      setError(err);
    }
  };

  const columns = [
    {
      key: "person", label: "Persona",
      render: (m) => (
        <span className="flex items-center gap-3">
          <Initials text={m.first_name || m.email || m.username} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">
              {m.first_name || m.email || m.username}
              {isMe(m) && <span className="ml-1.5 font-normal text-muted">(vos)</span>}
            </span>
            {m.first_name && <span className="block truncate text-[13px] text-muted">{m.email}</span>}
          </span>
        </span>
      ),
    },
    {
      key: "role", label: "Rol",
      render: (m) =>
        canManage ? (
          <select
            value={m.role}
            onChange={(e) => changeRole(m, e.target.value)}
            aria-label={`Rol de ${m.email || m.username}`}
            className="py-1 text-[13px]"
          >
            {Object.entries(ROLES).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
          </select>
        ) : (
          <RoleBadge role={m.role} />
        ),
    },
    { key: "last_login", label: "Último ingreso", className: "hidden sm:table-cell text-muted whitespace-nowrap", render: (m) => lastSeen(m.last_login) },
    ...(canManage
      ? [{
          key: "actions", label: <span className="sr-only">Acciones</span>, className: "text-right",
          render: (m) => (
            <span className="inline-flex gap-1">
              {!isMe(m) && <Button size="sm" variant="ghost" onClick={() => setResetting(m)}>Nueva contraseña</Button>}
              <Button size="sm" variant="ghost" onClick={() => remove(m)}>{isMe(m) ? "Salir" : "Quitar"}</Button>
            </span>
          ),
        }]
      : []),
  ];

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Panel
        title={members.data ? `${members.data.length} ${members.data.length === 1 ? "persona" : "personas"}` : "Equipo"}
        actions={canManage && <Button variant="primary" size="sm" onClick={() => setAdding(true)}><PlusIcon /> Sumar persona</Button>}
        bodyClassName="pt-2"
      >
        {(error || members.error) && <div className="px-5 pb-3"><ErrorNote error={error || members.error} /></div>}
        <Table columns={columns} rows={members.data || []} rowKey={(m) => m.id} highlight={justAdded} empty={members.data ? "Todavía no hay nadie." : "Cargando…"} />
      </Panel>

      <aside className="rounded-2xl border border-line bg-surface-2/60 p-5">
        <h2 className="text-[15px] font-semibold">Qué puede hacer cada rol</h2>
        <dl className="mt-3 space-y-3">
          {Object.entries(ROLES).reverse().map(([value, { help }]) => (
            <div key={value}>
              <dt><RoleBadge role={value} /></dt>
              <dd className="mt-1 text-[13px] leading-relaxed text-ink-2">{help}</dd>
            </div>
          ))}
        </dl>
        {!canManage && <p className="mt-4 text-[13px] text-muted">Para sumar personas o cambiar roles, pedíselo a un dueño de {clientName}.</p>}
      </aside>

      {resetting && (
        <ResetPasswordDialog clientId={clientId} member={resetting} onClose={() => setResetting(null)} />
      )}

      {adding && (
        <AddMemberDialog
          clientId={clientId}
          clientName={clientName}
          onClose={() => setAdding(false)}
          onAdded={(member) => {
            members.reload();
            // Sin toast: el diálogo de entrega ya confirma el alta.
            setJustAdded(member.id);
          }}
        />
      )}
    </div>
  );
}

function AddMemberDialog({ clientId, clientName, onClose, onAdded }) {
  const [values, setValues] = useState({ email: "", first_name: "", role: "viewer", password: generatePassword() });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(null);
  const set = (key) => (e) => setValues({ ...values, [key]: e.target?.value ?? e });

  if (added) {
    const email = added.email || values.email.trim().toLowerCase();
    const name = added.first_name || email;
    const handoff = added.user_created
      ? `Te sumé al equipo de ${clientName} en ${document.title}.\n\nIngresá en ${window.location.origin}\nUsuario: ${email}\nContraseña: ${values.password}\n\nCambiá la contraseña desde “Mi cuenta” la primera vez que entres.`
      : `Te sumé al equipo de ${clientName} en ${document.title}. Entrá en ${window.location.origin} con tu usuario de siempre (${email}).`;
    return (
      <Modal title={`${name} ya es parte del equipo`} onClose={onClose} wide>
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            {added.user_created
              ? "Creamos su usuario. Mandale este mensaje: la contraseña no se vuelve a mostrar."
              : "Ya tenía usuario, así que entra con su contraseña de siempre. Ahora va a ver los sitios de este cliente."}
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
    <Modal title={`Sumar a ${clientName}`} onClose={onClose} wide>
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const member = await api.post(`clients/${clientId}/members/`, {
              email: values.email.trim(), first_name: values.first_name.trim(), role: values.role, password: values.password,
            });
            setAdded(member);
            onAdded(member);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email">
            <input autoFocus required type="email" value={values.email} onChange={set("email")} className="w-full" placeholder="ana@empresa.com" />
          </Field>
          <Field label="Nombre (opcional)">
            <input maxLength={150} value={values.first_name} onChange={set("first_name")} className="w-full" placeholder="Ana" />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink-2">Rol</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(ROLES).map(([value, { label, help }]) => (
              <label
                key={value}
                className={`cursor-pointer rounded-xl border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                  values.role === value ? "border-accent bg-accent-wash" : "border-line hover:bg-surface-2"
                }`}
              >
                <input type="radio" name="role" value={value} checked={values.role === value} onChange={set("role")} className="sr-only" />
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-1 block text-xs leading-snug text-ink-2">{help}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Contraseña inicial" hint="Sólo se usa si el email no tiene usuario. Si ya tiene, se suma con su contraseña de siempre.">
          <InitialPasswordInput value={values.password} onChange={set("password")} />
        </Field>
        {error && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Sumando…" : "Sumar al equipo"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordDialog({ clientId, member, onClose }) {
  const [password, setPassword] = useState(generatePassword());
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const who = member.first_name || member.email || member.username;
  const message = `Tu nueva contraseña para ${document.title} es: ${password}\nIngresá en ${window.location.origin} con ${member.email || member.username} y cambiala desde “Mi cuenta”.`;
  return (
    <Modal title={done ? "Contraseña cambiada" : `Nueva contraseña para ${who}`} onClose={onClose} wide>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-2">Mandale este mensaje. La contraseña anterior ya no funciona.</p>
          <pre className="whitespace-pre-wrap rounded-lg border border-line bg-plane p-4 font-sans text-sm leading-relaxed">{message}</pre>
          <div className="flex justify-end gap-2">
            <CopyButton text={message} label="Copiar mensaje" />
            <Button variant="primary" onClick={onClose}>Listo</Button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api.post(`clients/${clientId}/members/${member.id}/reset-password/`, { password });
            setDone(true);
          } catch (err) {
            setError(err);
          }
        }}>
          <p className="text-sm text-ink-2">Para cuando alguien olvidó su contraseña. Va a tener que usar la nueva desde ahora.</p>
          <Field label="Contraseña nueva"><InitialPasswordInput value={password} onChange={setPassword} required /></Field>
          {error && <ErrorNote error={error} />}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button type="submit" variant="primary">Cambiar contraseña</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
