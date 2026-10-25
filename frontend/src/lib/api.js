const FIELD_LABELS = {
  owner: "Dueño", email: "Email", password: "Contraseña", first_name: "Nombre", name: "Nombre", domain: "Dominio",
  timezone: "Zona horaria", client_id: "Cliente", site_id: "Sitio", role: "Rol", config: "Configuración",
  current_password: "Contraseña actual", new_password: "Contraseña nueva", notes: "Notas",
};

export class ApiError extends Error {
  constructor(status, payload) {
    super(ApiError.messageFrom(payload) || `Error ${status}`);
    this.status = status;
    this.payload = payload;
  }

  // DRF devuelve {detail: "..."} o {campo: ["..."]}, a veces anidado ({owner: {email: [...]}}):
  // se aplana a un texto legible con los nombres de campo traducidos.
  static messageFrom(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.detail === "string") return payload.detail;
    const lines = [];
    const walk = (value, path) => {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        // "detail" y "non_field_errors" son mensajes generales: van sin etiqueta.
        const label = path.filter((key) => key !== "detail" && key !== "non_field_errors").map((key) => FIELD_LABELS[key] || key).join(" › ");
        lines.push(label ? `${label}: ${value.join(" ")}` : value.join(" "));
      } else if (value && typeof value === "object") {
        Object.entries(value).forEach(([key, child]) => walk(child, [...path, key]));
      } else if (value != null) {
        lines.push(String(value));
      }
    };
    walk(payload, []);
    return lines.join(" ");
  }
}

function csrfToken() {
  const match = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export async function request(method, path, { body, params, signal } = {}) {
  const url = new URL(`/api/${path}`, window.location.origin);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const headers = { Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-CSRFToken"] = csrfToken();
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    // Un 403 puede ser sesión vencida o un rol sin permiso: AppContext lo distingue con auth/me.
    if (response.status === 403 && !path.startsWith("auth/")) {
      window.dispatchEvent(new Event("auth:check"));
    }
    throw new ApiError(response.status, payload);
  }
  return payload;
}

export const api = {
  get: (path, params, options) => request("GET", path, { ...options, params }),
  post: (path, body, options) => request("POST", path, { ...options, body }),
  patch: (path, body) => request("PATCH", path, { body }),
  put: (path, body) => request("PUT", path, { body }),
  delete: (path) => request("DELETE", path),
};
