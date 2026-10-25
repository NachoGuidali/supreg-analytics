import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import { resolveRange } from "../lib/dates";
import { useStoredState } from "../lib/hooks";
import { applyBrand, applyThemeMode } from "../lib/theme";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = verificando
  const [sites, setSites] = useState(null);
  const [siteId, setSiteId] = useStoredState("an.siteId", null);
  const [range, setRange] = useStoredState("an.range", { preset: "30d" });
  const [brand, setBrand] = useState(null);
  const [sales, setSales] = useState(null); // links de "Contratar" para quien no tiene cuenta
  // null = el usuario no eligió: se usa el tema por defecto de la marca.
  const [themeChoice, setThemeChoice] = useStoredState("an.theme", null);
  const themeMode = themeChoice || brand?.default_theme || "system";

  const checkSession = useCallback(async () => {
    const me = await api.get("auth/me/").catch(() => ({ authenticated: false }));
    if (me.brand) setBrand(me.brand);
    if (me.sales) setSales(me.sales);
    setUser(me.authenticated ? me : null);
  }, []);

  useEffect(() => applyBrand(brand), [brand]);
  useEffect(() => applyThemeMode(themeMode), [themeMode]);

  const loadSites = useCallback(async () => {
    const list = await api.get("sites/");
    setSites(list);
    return list;
  }, []);

  useEffect(() => {
    checkSession();
    window.addEventListener("auth:check", checkSession);
    return () => window.removeEventListener("auth:check", checkSession);
  }, [checkSession]);

  useEffect(() => {
    if (user) loadSites().catch(() => setSites([]));
    // Por usuario y no por objeto: re-verificar la sesión tras un 403 no recarga los sitios.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username, loadSites]);

  const site = useMemo(() => {
    if (!sites || !sites.length) return null;
    return sites.find((s) => s.id === siteId) || sites[0];
  }, [sites, siteId]);

  const dates = useMemo(
    () => resolveRange(range, site?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone),
    [range, site]
  );

  const isPlatformAdmin = Boolean(user?.is_platform_admin);
  /** Rol del usuario en un cliente: owner | editor | viewer | null. La plataforma es dueña de todo. */
  const roleIn = useCallback(
    (clientId) => (isPlatformAdmin ? "owner" : user?.memberships?.find((m) => m.client_id === clientId)?.role || null),
    [user, isPlatformAdmin]
  );
  const role = site ? roleIn(site.client_id) : null;
  const ownedClients = isPlatformAdmin ? [] : (user?.memberships || []).filter((m) => m.role === "owner");

  const value = {
    user,
    refreshUser: checkSession,
    isPlatformAdmin,
    roleIn,
    // Permisos sobre el sitio actual.
    role,
    canEdit: role === "owner" || role === "editor",
    isOwner: role === "owner",
    // Puede dar de alta sitios: la plataforma (eligiendo cliente) o quien es dueño de algún cliente.
    canCreateSites: isPlatformAdmin || ownedClients.length > 0,
    ownedClients,
    login: async (username, password) => setUser(await api.post("auth/login/", { username, password })),
    brand,
    sales,
    themeMode,
    setThemeMode: setThemeChoice,
    logout: async () => {
      await api.post("auth/logout/").catch(() => {});
      setUser(null);
      setSites(null);
    },
    sites,
    site,
    selectSite: setSiteId,
    reloadSites: loadSites,
    range,
    setRange,
    dates,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}

/** Parámetros de fecha para la API: rango global resuelto en la zona del sitio. */
export function useDateParams() {
  const { dates } = useApp();
  return { date_from: dates.from, date_to: dates.to };
}
