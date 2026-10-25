import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";

export function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Carga asíncrona que conserva el último resultado mientras recarga
 * (los gráficos se atenúan en vez de parpadear) y descarta respuestas viejas.
 */
export function useAsync(loader, deps, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    loader(controller.signal)
      .then((data) => !controller.signal.aborted && setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (!controller.signal.aborted) setState((s) => ({ data: s.data, error, loading: false }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  return { ...state, reload };
}

export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage no disponible: el estado vive sólo en memoria */
    }
  }, [key, value]);
  return [value, setValue];
}

/** Lee colores de los tokens CSS y se actualiza al cambiar de tema (sistema, usuario o marca). */
export function useCssVars(names) {
  const read = useCallback(() => {
    const styles = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((name) => [name, styles.getPropertyValue(`--${name}`).trim()]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join(",")]);
  const [vars, setVars] = useState(read);
  const media = useRef(null);
  useEffect(() => {
    media.current = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setVars(read());
    media.current.addEventListener("change", update);
    window.addEventListener("theme:change", update);
    return () => {
      media.current.removeEventListener("change", update);
      window.removeEventListener("theme:change", update);
    };
  }, [read]);
  return vars;
}

/**
 * Cuenta desde 0 hasta `value` la primera vez que llega un valor (después salta directo).
 * Sin animación si el usuario pidió reducir el movimiento.
 */
export function useCountUp(value, duration = 900) {
  const [shown, setShown] = useState(value);
  const done = useRef(false);
  useEffect(() => {
    if (value === null || value === undefined) return undefined;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (done.current || reduce) {
      setShown(value);
      return undefined;
    }
    done.current = true;
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

/** Reporte fijo (/api/reports/<name>/) del sitio actual sobre el rango global. */
export function useReport(endpoint, siteId, dateParams, extra = {}, { enabled = true } = {}) {
  const key = JSON.stringify(extra);
  return useAsync(
    (signal) => api.get(endpoint, { site_id: siteId, ...dateParams, ...extra }, { signal }),
    [endpoint, siteId, dateParams.date_from, dateParams.date_to, key],
    { enabled }
  );
}
