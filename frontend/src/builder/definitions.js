export const ANALYSIS_TYPES = [
  { value: "trend", label: "Tendencia", help: "Cómo evoluciona un evento en el tiempo." },
  { value: "funnel", label: "Embudo", help: "Cuántos visitantes completan una secuencia de pasos." },
  { value: "retention", label: "Retención", help: "Qué porcentaje vuelve en los días o semanas siguientes." },
  { value: "breakdown", label: "Ranking", help: "Los valores más frecuentes de una propiedad." },
  { value: "metric", label: "Número", help: "Un solo total, comparado con el período anterior." },
];

export const MEASURES = [
  { value: "count", label: "Eventos" },
  { value: "unique_visitors", label: "Visitantes únicos" },
  { value: "unique_sessions", label: "Sesiones" },
];

export const PERIODS = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
];

export const OPERATOR_LABELS = {
  equals: "es",
  not_equals: "no es",
  contains: "contiene",
  not_contains: "no contiene",
  gt: "mayor que",
  gte: "mayor o igual a",
  lt: "menor que",
  lte: "menor o igual a",
  in: "es uno de",
  is_set: "tiene valor",
  is_not_set: "no tiene valor",
};

export const VALUELESS_OPERATORS = ["is_set", "is_not_set"];

export function fieldLabel(name) {
  return name?.startsWith("properties.") ? name.slice("properties.".length) : name;
}

export function defaultConfig(type, eventName = "") {
  switch (type) {
    case "trend":
      return { event_name: eventName, measure: "unique_visitors", group_by: "day", breakdown_by: "", breakdown_limit: 5, filters: [] };
    case "funnel":
      return { steps: [{ event_name: eventName, filters: [] }, { event_name: "", filters: [] }], conversion_window_hours: 24, filters: [] };
    case "retention":
      return { start_event: eventName, return_event: eventName, period: "day", periods_count: 7, filters: [] };
    case "breakdown":
      return { event_name: eventName, breakdown_by: "", measure: "count", limit: 10, filters: [] };
    case "metric":
      return { event_name: eventName, measure: "unique_visitors", compare_to_previous_period: true, filters: [] };
    default:
      return {};
  }
}

/** Evento "principal" de una config: sirve para sugerir propiedades en los filtros. */
export function mainEvent(type, config) {
  if (type === "funnel") return config.steps?.[0]?.event_name || "";
  if (type === "retention") return config.start_event || "";
  return config.event_name || "";
}

function isCompleteFilter(filter) {
  if (!filter.property || !filter.operator) return false;
  if (VALUELESS_OPERATORS.includes(filter.operator)) return true;
  if (filter.operator === "in") return Array.isArray(filter.value) && filter.value.length > 0;
  return filter.value !== "" && filter.value !== null && filter.value !== undefined;
}

const cleanFilters = (filters = []) =>
  filters.filter(isCompleteFilter).map(({ property, operator, value }) =>
    VALUELESS_OPERATORS.includes(operator) ? { property, operator } : { property, operator, value }
  );

/**
 * Config lista para la API: sin filtros a medio completar y sin campos vacíos.
 * Devuelve null si todavía falta algo obligatorio (no tiene sentido pedir el preview).
 */
export function toApiConfig(type, config) {
  switch (type) {
    case "trend": {
      if (!config.event_name) return null;
      const { breakdown_by, breakdown_limit, ...rest } = config;
      return { ...rest, filters: cleanFilters(config.filters), ...(breakdown_by ? { breakdown_by, breakdown_limit } : {}) };
    }
    case "funnel": {
      const steps = (config.steps || []).map((s) => ({ event_name: s.event_name, filters: cleanFilters(s.filters) }));
      if (steps.length < 2 || steps.some((s) => !s.event_name)) return null;
      return { ...config, steps, filters: cleanFilters(config.filters) };
    }
    case "retention":
      if (!config.start_event || !config.return_event) return null;
      return { ...config, filters: cleanFilters(config.filters) };
    case "breakdown":
      if (!config.event_name || !config.breakdown_by) return null;
      return { ...config, filters: cleanFilters(config.filters) };
    case "metric":
      if (!config.event_name) return null;
      return { ...config, filters: cleanFilters(config.filters) };
    default:
      return null;
  }
}

/** Config guardada -> estado editable (completa campos opcionales que la API omite). */
export function fromApiConfig(type, config) {
  const base = defaultConfig(type);
  if (type === "funnel") {
    return { ...base, ...config, steps: config.steps.map((s) => ({ filters: [], ...s })) };
  }
  return { ...base, ...config };
}

const measureText = (measure) => MEASURES.find((m) => m.value === measure)?.label.toLowerCase() || measure;
const periodText = { day: "día", week: "semana", month: "mes" };

function valueText(filter) {
  if (VALUELESS_OPERATORS.includes(filter.operator)) return "";
  return Array.isArray(filter.value) ? filter.value.join(", ") : String(filter.value);
}

function filtersSentence(filters) {
  const complete = cleanFilters(filters);
  if (!complete.length) return [];
  const parts = [{ text: " donde " }];
  complete.forEach((filter, index) => {
    if (index) parts.push({ text: " y " });
    parts.push({ strong: fieldLabel(filter.property) }, { text: ` ${OPERATOR_LABELS[filter.operator]} ` });
    const value = valueText(filter);
    if (value) parts.push({ strong: value });
  });
  return parts;
}

const eventOrBlank = (name) => ({ strong: name || "…", missing: !name });

/**
 * La config como frase, en partes [{text}|{strong}]. Es el encabezado del preview:
 * permite leer de un vistazo qué pregunta responde el gráfico.
 */
export function describe(type, config) {
  switch (type) {
    case "trend":
      return [
        { strong: capitalize(measureText(config.measure)) },
        { text: " de " },
        eventOrBlank(config.event_name),
        ...filtersSentence(config.filters),
        { text: ", por " },
        { strong: periodText[config.group_by] },
        ...(config.breakdown_by ? [{ text: ", separado por " }, { strong: fieldLabel(config.breakdown_by) }] : []),
      ];
    case "funnel": {
      const parts = [{ text: "Visitantes que hacen " }];
      (config.steps || []).forEach((step, index) => {
        if (index) parts.push({ text: " → " });
        parts.push(eventOrBlank(step.event_name));
      });
      const hours = config.conversion_window_hours;
      parts.push({ text: " en menos de " }, { strong: hours % 24 === 0 ? `${hours / 24} ${hours === 24 ? "día" : "días"}` : `${hours} h` });
      return [...parts, ...filtersSentence(config.filters)];
    }
    case "retention":
      return [
        { text: "De quienes hicieron " },
        eventOrBlank(config.start_event),
        { text: " por primera vez, cuántos vuelven a hacer " },
        eventOrBlank(config.return_event),
        { text: " cada " },
        { strong: periodText[config.period] },
        ...filtersSentence(config.filters),
      ];
    case "breakdown":
      return [
        { text: "Top " },
        { strong: String(config.limit) },
        { text: " de " },
        { strong: config.breakdown_by ? fieldLabel(config.breakdown_by) : "…", missing: !config.breakdown_by },
        { text: " en " },
        eventOrBlank(config.event_name),
        { text: ", por " },
        { strong: measureText(config.measure) },
        ...filtersSentence(config.filters),
      ];
    case "metric":
      return [
        { strong: capitalize(measureText(config.measure)) },
        { text: " de " },
        eventOrBlank(config.event_name),
        ...filtersSentence(config.filters),
        ...(config.compare_to_previous_period ? [{ text: ", comparado con el período anterior" }] : []),
      ];
    default:
      return [];
  }
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
