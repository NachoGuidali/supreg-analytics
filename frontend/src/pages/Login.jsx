import { useMemo, useState } from "react";

import { BrandMark } from "../components/Layout";
import { Button, ErrorNote } from "../components/ui";
import { useApp } from "../state/AppContext";

const WIDTH = 1200;
const HEIGHT = 260;

/**
 * Curva de visitas sintética: ritmo semanal, una tendencia que crece y ruido fijo
 * (semilla constante, así es la misma en cada carga). Termina arriba, en el "ahora".
 */
function signalPath() {
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const points = 56;
  const coords = Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    const weekly = Math.sin((i / 7) * Math.PI * 2 - 1.2) * 0.13;
    const trend = t ** 1.6 * 0.5;
    const noise = (random() - 0.5) * 0.1;
    const y = 0.18 + trend + weekly + noise;
    return [t * WIDTH * 0.96, HEIGHT - Math.min(0.92, Math.max(0.06, y)) * HEIGHT];
  });
  const d = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return { d, end: coords[coords.length - 1] };
}

function Signal() {
  const { d, end } = useMemo(signalPath, []);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-[10%] h-[34vh]">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <path d={`${d} L${end[0]} ${HEIGHT} L0 ${HEIGHT} Z`} fill="var(--accent-on-dark)" opacity="0.04" />
        <path
          d={d}
          pathLength="1"
          fill="none"
          stroke="var(--accent-on-dark)"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeLinejoin="round"
          style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: "draw-signal 2.4s cubic-bezier(0.45, 0, 0.2, 1) 0.2s forwards" }}
        />
      </svg>
      {/* Fuera del SVG: con preserveAspectRatio="none" un círculo se estiraría. */}
      <span
        className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-on-dark shadow-[0_0_0_6px_color-mix(in_srgb,var(--accent-on-dark)_20%,transparent)]"
        style={{ left: `${(end[0] / WIDTH) * 100}%`, top: `${(end[1] / HEIGHT) * 100}%`, opacity: 0, animation: "pop-in 300ms ease-out 2.55s forwards" }}
      />
    </div>
  );
}

export default function Login() {
  const { login, sales } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const field = "w-full rounded-lg border border-rail-line bg-white/[0.04] px-3 py-2.5 text-rail-ink placeholder:text-rail-muted";

  return (
    <main className="brand-stage brand-canvas relative min-h-screen overflow-hidden">
      <Signal />
      <div className="relative mx-auto grid min-h-screen max-w-6xl content-center gap-12 px-5 py-12 md:grid-cols-[1fr_380px] md:items-center md:px-10">
        <div className="max-w-xl">
          <BrandMark size="lg" />
          <h1 className="mt-10 text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] [text-wrap:balance] md:text-[56px]">
            Cómo llega y qué hace la gente en tus sitios.
          </h1>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-rail-muted">
            Visitas, campañas, embudos y retención de todas tus webs, en un solo lugar.
          </p>
          {sales?.product_url && (
            <a href={sales.product_url} className="mt-6 inline-block text-[15px] font-medium text-accent-on-dark underline-offset-4 hover:underline">
              Conocé todo lo que mide
            </a>
          )}
        </div>

        <form
          className="space-y-4 rounded-2xl border border-rail-line bg-rail-raised/80 p-7 shadow-2xl backdrop-blur-md"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await login(username.trim(), password);
            } catch (err) {
              setError(err);
              setBusy(false);
            }
          }}
        >
          <h2 className="text-xl font-semibold tracking-tight">Ingresá a tu cuenta</h2>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-rail-muted">Email o usuario</span>
            <input autoFocus required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-rail-muted">Contraseña</span>
            <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          </label>
          {error && <ErrorNote error={error} />}
          <Button type="submit" variant="primary" disabled={busy} className="w-full justify-center py-2.5">
            {busy ? "Ingresando…" : "Ingresar"}
          </Button>
          <p className="text-[13px] text-rail-muted">¿Olvidaste la contraseña? Pedile a quien administra tu cuenta que te asigne una nueva.</p>
          {sales?.url && (
            <div className="border-t border-rail-line pt-4">
              <p className="text-sm text-rail-ink">¿Todavía no tenés cuenta?</p>
              <a
                href={sales.url}
                target="_blank"
                rel="noopener"
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-rail-line px-3 py-2.5 text-sm font-medium text-rail-ink transition-colors hover:border-accent-on-dark hover:text-accent-on-dark"
              >
                Contratar SupReg Analytics
              </a>
            </div>
          )}
        </form>
      </div>
    </main>
  );
}
