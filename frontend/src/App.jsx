import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";

import Layout from "./components/Layout";
import Account from "./pages/Account";
import Acquisition from "./pages/Acquisition";
import Audience from "./pages/Audience";
import Behavior from "./pages/Behavior";
import Capture from "./pages/Capture";
import Dashboards, { DashboardView } from "./pages/Dashboards";
import Events from "./pages/Events";
import Goals from "./pages/Goals";
import Help from "./pages/Help";
import Insights from "./pages/Insights";
import Builder from "./pages/Builder";
import ClientDetail from "./pages/ClientDetail";
import Clients from "./pages/Clients";
import Install from "./pages/Install";
import Live from "./pages/Live";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Plans from "./pages/Plans";
import Saved from "./pages/Saved";
import Team from "./pages/Team";
import { AppProvider, useApp } from "./state/AppContext";
import { ToastProvider } from "./state/Toasts";

/** Vistas de analítica: necesitan un sitio. Sin sitios, cada quien va a donde puede crear uno. */
function RequireSite({ children }) {
  const { sites, isPlatformAdmin } = useApp();
  const { pathname } = useLocation();
  if (sites === null) return <p className="text-sm text-muted">Cargando sitios…</p>;
  if (sites.length === 0 && pathname !== "/instalacion") {
    return <Navigate to={isPlatformAdmin ? "/plataforma/clientes" : "/instalacion"} replace />;
  }
  return children;
}

function RequirePlatformAdmin({ children }) {
  const { isPlatformAdmin } = useApp();
  return isPlatformAdmin ? children : <Navigate to="/" replace />;
}

function Routed() {
  const { user } = useApp();
  if (user === undefined) return null;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<RequireSite><Overview /></RequireSite>} />
        <Route path="adquisicion" element={<RequireSite><Acquisition /></RequireSite>} />
        <Route path="comportamiento" element={<RequireSite><Behavior /></RequireSite>} />
        <Route path="audiencia" element={<RequireSite><Audience /></RequireSite>} />
        <Route path="mejoras" element={<RequireSite><Insights /></RequireSite>} />
        <Route path="dashboards" element={<RequireSite><Dashboards /></RequireSite>} />
        <Route path="dashboards/:id" element={<RequireSite><DashboardView /></RequireSite>} />
        <Route path="captura" element={<RequireSite><Capture /></RequireSite>} />
        <Route path="objetivos" element={<RequireSite><Goals /></RequireSite>} />
        <Route path="eventos" element={<RequireSite><Events /></RequireSite>} />
        <Route path="ayuda" element={<Help />} />
        <Route path="constructor" element={<RequireSite><Builder /></RequireSite>} />
        <Route path="constructor/:id" element={<RequireSite><Builder /></RequireSite>} />
        <Route path="analisis" element={<RequireSite><Saved /></RequireSite>} />
        <Route path="en-vivo" element={<RequireSite><Live /></RequireSite>} />
        <Route path="instalacion" element={<RequireSite><Install /></RequireSite>} />
        <Route path="equipo" element={<Team />} />
        <Route path="cuenta" element={<Account />} />
        <Route path="plataforma/clientes" element={<RequirePlatformAdmin><Clients /></RequirePlatformAdmin>} />
        <Route path="plataforma/planes" element={<RequirePlatformAdmin><Plans /></RequirePlatformAdmin>} />
        <Route path="plataforma/clientes/:id" element={<RequirePlatformAdmin><ClientDetail /></RequirePlatformAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routed />
        </BrowserRouter>
      </ToastProvider>
    </AppProvider>
  );
}
