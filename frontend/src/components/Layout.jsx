import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { useApp } from "../state/AppContext";
import DateRangePicker from "./DateRangePicker";
import {
  AccountIcon, AcquisitionIcon, AudienceIcon, BehaviorIcon, BuilderIcon, CaptureIcon, ChevronIcon, ClientsIcon,
  DashboardIcon, EventsIcon, GoalIcon, HelpIcon, HomeIcon, InsightsIcon, InstallIcon, LiveIcon, LogoutIcon, MoonIcon, PlanIcon,
  SavedIcon, SunIcon, SystemIcon, TeamIcon,
} from "./icons";
import { api } from "../lib/api";
import { useAsync, useStoredState } from "../lib/hooks";
import { billingText, formatDate, needsAttention } from "./Billing";
import { Initials, ROLES, RoleBadge } from "./ui";

// Vistas donde el rango de fechas no aplica.
const WITHOUT_DATES = ["/plataforma/planes", "/en-vivo", "/instalacion", "/equipo", "/cuenta", "/plataforma", "/captura", "/eventos", "/ayuda"];

/** Marca: una señal ámbar dentro de un cuadro, y el nombre con la primera palabra destacada. */
export function BrandMark({ size = "md" }) {
  const { brand } = useApp();
  const [logoFailed, setLogoFailed] = useState(false);
  const large = size === "lg";
  if (brand?.logo_url && !logoFailed) {
    return <img src={brand.logo_url} alt={brand.name} className={`${large ? "h-14" : "h-8"} w-auto max-w-full object-contain object-left`} onError={() => setLogoFailed(true)} />;
  }
  const [first, ...rest] = (brand?.name || "SupReg Analytics").split(" ");
  return (
    <span className={`flex items-center gap-2.5 font-display tracking-tight ${large ? "text-[28px]" : "text-[18px]"}`}>
      <SignalMark size={large ? 36 : 26} />
      <span>
        <span className="font-semibold">{first}</span>
        {rest.length > 0 && <span className="font-normal text-rail-muted"> {rest.join(" ")}</span>}
      </span>
    </span>
  );
}

export function SignalMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <rect width="24" height="24" rx="6.5" fill="rgba(255,255,255,0.07)" />
      <path d="M4 14h3.5l2.5-6 3.5 10 2.5-6H20" fill="none" stroke="var(--accent-on-dark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ThemeSwitch() {
  const { themeMode, setThemeMode } = useApp();
  const options = [
    { value: "system", label: "Tema del sistema", icon: SystemIcon },
    { value: "light", label: "Tema claro", icon: SunIcon },
    { value: "dark", label: "Tema oscuro", icon: MoonIcon },
  ];
  return (
    <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-lg border border-rail-line p-0.5">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={themeMode === value}
          aria-label={label}
          title={label}
          onClick={() => setThemeMode(value)}
          className={`rounded-md p-1.5 ${themeMode === value ? "bg-white/10 text-rail-ink" : "text-rail-muted hover:text-rail-ink"}`}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}

function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, ref]);
}

/** Selector de sitio. Con más de un cliente agrupa los sitios por cliente. */
function SiteSwitcher() {
  const { sites, site, selectSite, canCreateSites, roleIn, isPlatformAdmin } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef();
  const navigate = useNavigate();
  useDismiss(open, setOpen, ref);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map();
    for (const s of sites || []) {
      if (q && !`${s.name} ${s.domain} ${s.client_name}`.toLowerCase().includes(q)) continue;
      if (!map.has(s.client_id)) map.set(s.client_id, { id: s.client_id, name: s.client_name, sites: [] });
      map.get(s.client_id).sites.push(s);
    }
    return [...map.values()];
  }, [sites, query]);
  const clientCount = new Set((sites || []).map((s) => s.client_id)).size;

  if (!sites?.length) return null;
  return (
    <div ref={ref} className="relative px-3">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl border border-rail-line bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-rail-ink">{site?.name}</span>
          <span className="block truncate text-xs text-rail-muted">{clientCount > 1 ? site?.client_name : site?.domain}</span>
        </span>
        <span className={`text-rail-muted transition-transform ${open ? "rotate-180" : ""}`}><ChevronIcon /></span>
      </button>
      {open && (
        <div className="animate-pop absolute inset-x-3 top-full z-40 mt-1.5 max-h-[60vh] overflow-y-auto rounded-xl border border-rail-line bg-rail-raised p-1.5 shadow-2xl">
          {sites.length > 6 && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar sitio o cliente"
              aria-label="Buscar sitio o cliente"
              className="mb-1.5 w-full border-rail-line bg-white/[0.04] text-sm text-rail-ink placeholder:text-rail-muted"
            />
          )}
          <div role="listbox" aria-label="Sitios">
            {groups.map((group) => (
              <div key={group.id} role="group" aria-label={group.name} className="py-1">
                {clientCount > 1 && (
                  <p className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-1.5 text-xs text-rail-muted">
                    <span className="truncate">{group.name}</span>
                    {!isPlatformAdmin && <RoleBadge role={roleIn(group.id)} onDark />}
                  </p>
                )}
                {group.sites.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={s.id === site?.id}
                    onClick={() => {
                      selectSite(s.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${
                      s.id === site?.id ? "bg-white/[0.08] text-rail-ink" : "text-rail-ink/85 hover:bg-white/[0.05]"
                    }`}
                  >
                    <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.id === site?.id ? "bg-accent-on-dark" : "bg-white/15"}`} />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="max-w-[45%] truncate text-xs text-rail-muted">{s.domain}</span>
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && <p className="px-2.5 py-3 text-sm text-rail-muted">Ningún sitio coincide con “{query}”.</p>}
          </div>
          {canCreateSites && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/instalacion?nuevo=1");
              }}
              className="mt-1 w-full rounded-lg border-t border-rail-line px-2.5 py-2 text-left text-sm text-accent-on-dark hover:bg-white/[0.05]"
            >
              Agregar sitio
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NavItem({ to, label, icon: Icon, end, badge }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-[7px] text-sm transition-colors ${
          isActive
            ? "bg-white/[0.07] font-medium text-rail-ink before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r before:bg-accent-on-dark before:content-[''] max-md:before:hidden"
            : "text-rail-muted hover:bg-white/[0.04] hover:text-rail-ink"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className={isActive ? "text-accent-on-dark" : ""}><Icon /></span>
          {label}
          {badge > 0 && (
            <span className="ml-auto rounded-full bg-accent-on-dark px-1.5 text-[11px] font-semibold leading-[18px] text-accent-ink-on-dark tabular" aria-label={`${badge} por vencer o vencidos`}>
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function NavGroup({ title, children }) {
  return (
    <div className="flex gap-1 md:flex-col">
      <p className="hidden px-3 pb-1 pt-3.5 text-xs text-rail-muted/80 md:block">{title}</p>
      {children}
    </div>
  );
}

export default function Layout() {
  const { user, logout, sites, site, isPlatformAdmin, role } = useApp();
  const { pathname } = useLocation();
  const showDates = !WITHOUT_DATES.some((path) => pathname.startsWith(path));
  const hasSites = sites?.length > 0;
  const displayName = user?.first_name || user?.email || user?.username;
  // Plataforma: clientes por vencer o vencidos, para el contador del menú.
  const clients = useAsync((signal) => api.get("clients/", undefined, { signal }), [pathname === "/plataforma/clientes"], { enabled: isPlatformAdmin });
  const attention = (clients.data || []).filter((c) => needsAttention(c.billing)).length;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[256px_1fr]">
      <aside className="brand-stage md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 md:block md:px-6 md:pb-5 md:pt-6">
          <Link to="/" className="rounded-md"><BrandMark /></Link>
          <button type="button" onClick={logout} aria-label="Cerrar sesión" className="rounded-md p-1.5 text-rail-muted hover:text-rail-ink md:hidden">
            <LogoutIcon />
          </button>
        </div>
        <SiteSwitcher />
        <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-3 py-3 md:flex-1 md:flex-col md:overflow-y-auto md:py-1">
          {hasSites && (
            <NavGroup title="Analítica">
              <NavItem to="/" label="Resumen" icon={HomeIcon} end />
              <NavItem to="/adquisicion" label="Adquisición" icon={AcquisitionIcon} />
              <NavItem to="/comportamiento" label="Comportamiento" icon={BehaviorIcon} />
              <NavItem to="/audiencia" label="Audiencia" icon={AudienceIcon} />
              <NavItem to="/mejoras" label="Mejoras" icon={InsightsIcon} />
            </NavGroup>
          )}
          {hasSites && (
            <NavGroup title="Explorar">
              <NavItem to="/dashboards" label="Dashboards" icon={DashboardIcon} />
              <NavItem to="/constructor" label="Constructor" icon={BuilderIcon} />
              <NavItem to="/analisis" label="Análisis guardados" icon={SavedIcon} />
              <NavItem to="/en-vivo" label="Eventos en vivo" icon={LiveIcon} />
            </NavGroup>
          )}
          {(hasSites || role) && (
            <NavGroup title="Configuración">
              {hasSites && <NavItem to="/captura" label="Captura de datos" icon={CaptureIcon} />}
              {hasSites && <NavItem to="/objetivos" label="Objetivos" icon={GoalIcon} />}
              {hasSites && <NavItem to="/eventos" label="Eventos" icon={EventsIcon} />}
              <NavItem to="/instalacion" label="Instalación" icon={InstallIcon} />
              <NavItem to="/equipo" label="Equipo" icon={TeamIcon} />
            </NavGroup>
          )}
          {isPlatformAdmin && (
            <NavGroup title="Plataforma">
              <NavItem to="/plataforma/clientes" label="Clientes" icon={ClientsIcon} badge={attention} />
              <NavItem to="/plataforma/planes" label="Planes" icon={PlanIcon} />
            </NavGroup>
          )}
          <div className="flex gap-1 md:block md:pt-3">
            <NavItem to="/ayuda" label="Ayuda" icon={HelpIcon} />
            <span className="md:hidden"><NavItem to="/cuenta" label="Mi cuenta" icon={AccountIcon} /></span>
          </div>
        </nav>
        <div className="hidden space-y-3 border-t border-rail-line px-4 py-4 md:block">
          <Link to="/cuenta" className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/[0.04]">
            <Initials text={displayName} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-rail-ink">{displayName}</span>
              <span className="block truncate text-xs text-rail-muted">
                {isPlatformAdmin ? "Administrador" : role ? `${ROLES[role].label} en ${site?.client_name}` : "Mi cuenta"}
              </span>
            </span>
          </Link>
          <div className="flex items-center justify-between gap-2 px-2">
            <ThemeSwitch />
            <button type="button" onClick={logout} className="flex items-center gap-1.5 text-[13px] text-rail-muted hover:text-rail-ink">
              <LogoutIcon /> Salir
            </button>
          </div>
        </div>
      </aside>

      <div className="brand-canvas min-w-0 overflow-hidden">
        {showDates && site && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-line bg-plane/80 px-4 py-3 backdrop-blur-md md:px-8">
            <DateRangePicker />
            <span className="ml-auto hidden items-center gap-2 text-[13px] text-muted lg:flex">
              <span className="h-2 w-2 rounded-full bg-accent-fill" aria-hidden="true" />
              {site.domain}
            </span>
          </div>
        )}
        <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
          <RenewBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Aviso a los dueños cuando el plan del cliente actual está por vencer o vencido. Se puede ocultar por hoy. */
function RenewBanner() {
  const { user, site } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const membership = user?.memberships?.find((m) => m.client_id === site?.client_id) || (!site && user?.memberships?.[0]);
  const billing = membership?.billing;
  const [hiddenOn, setHiddenOn] = useStoredState(`an.renewHidden.${membership?.client_id}`, null);
  if (!billing || !needsAttention(billing) || hiddenOn === today) return null;
  const overdue = billing.status !== "expiring";
  return (
    <div role="status" className={`mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-5 py-3.5 ${overdue ? "border-bad/40 bg-bad/10" : "border-status-warning/40 bg-status-warning/10"}`}>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">
          {billing.plan_name ? `Plan ${billing.plan_name} de ${membership.client_name}: ` : `${membership.client_name}: `}
          {billingText(billing).toLowerCase()}
        </span>
        <span className="text-ink-2">
          {billing.paid_until && ` (${formatDate(billing.paid_until)}).`}{" "}
          {overdue ? "Renovalo para no perder el acceso a tus datos." : "Renovalo para seguir midiendo sin cortes."}
        </span>
      </p>
      <div className="flex items-center gap-2">
        {billing.renew_url && (
          <a href={billing.renew_url} target="_blank" rel="noopener" className="rounded-lg bg-accent-fill px-3.5 py-1.5 text-sm font-medium text-accent-fill-ink hover:bg-accent-fill-hover">Renovar</a>
        )}
        {!overdue && <button type="button" onClick={() => setHiddenOn(today)} className="rounded-lg px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2">Ocultar por hoy</button>}
      </div>
    </div>
  );
}
