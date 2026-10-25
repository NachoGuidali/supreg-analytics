import { useEffect, useState } from "react";

import { api } from "../lib/api";

// Cache por sesión de navegador: los selectores del constructor se abren muchas veces.
const cache = new Map();

function cached(key, loader) {
  if (!cache.has(key)) {
    cache.set(key, loader().catch((error) => {
      cache.delete(key);
      throw error;
    }));
  }
  return cache.get(key);
}

function useCachedLoad(key, loader) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    if (!key) {
      setState({ data: null, error: null });
      return undefined;
    }
    let cancelled = false;
    cached(key, loader)
      .then((data) => !cancelled && setState({ data, error: null }))
      .catch((error) => !cancelled && setState({ data: null, error }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function useEventNames(siteId) {
  const { data, error } = useCachedLoad(siteId && `names:${siteId}`, () =>
    api.get("events/names/", { site_id: siteId }).then((r) => r.event_names)
  );
  return { names: data || [], loading: !data && !error, error };
}

export function useEventFields(siteId, eventName) {
  const { data, error } = useCachedLoad(siteId && eventName && `fields:${siteId}:${eventName}`, () =>
    api.get("events/properties/", { site_id: siteId, event_name: eventName })
  );
  return { fields: data?.fields || [], operatorsByType: data?.operators_by_type || {}, error };
}

export function clearEventMetadataCache() {
  cache.clear();
}
