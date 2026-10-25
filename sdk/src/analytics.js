/*!
 * analytics.js — SDK de tracking sin dependencias.
 *
 * <script src="https://TU-BACKEND/static/analytics.js" data-api-key="..." defer></script>
 *
 * Atributos opcionales del <script>:
 *   data-endpoint="https://otro-host"  host de la API si no es el mismo que sirve el script
 *   data-debug                         loguea cada evento en la consola
 *
 * Qué se captura solo y los eventos sin código (click en un selector, visita a una página,
 * scroll, tiempo, formulario) se configuran desde el dashboard: el script baja esa
 * configuración de /api/track/config/ y la guarda unos minutos en localStorage.
 */
(function (window, document) {
  "use strict";

  const script = document.currentScript || document.querySelector("script[data-api-key]");
  if (!script || (window.analytics && window.analytics._loaded)) return;

  const nav = navigator;
  const API_KEY = script.getAttribute("data-api-key");
  const DEBUG = script.hasAttribute("data-debug");
  const BASE = (script.getAttribute("data-endpoint") || new URL(script.src, location.href).origin).replace(/\/+$/, "");
  const ENDPOINT = BASE + "/api/track/batch/";

  const SESSION_TIMEOUT = 30 * 60 * 1000;
  const FLUSH_INTERVAL = 5000;
  const BATCH_SIZE = 10;
  const MAX_PER_REQUEST = 100;
  const MAX_RETRY = 200;
  const BOUNCE_SECONDS = 10;
  const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  const K_VISITOR = "_an_vid";
  const K_SESSION = "_an_ses";
  const K_ATTRIBUTION = "_an_attr";
  const K_RETRY = "_an_retry";
  const K_CONFIG = "_an_cfg";
  const CONFIG_TTL = 5 * 60 * 1000;
  const DOWNLOAD_RE = /\.(pdf|zip|rar|7z|gz|docx?|xlsx?|pptx?|csv|txt|odt|ods|mp3|mp4|mov|dmg|exe|msi|apk|epub)$/i;

  // Llamadas hechas antes de que cargue el script (ver stub en la página de instalación).
  const pending = window.analytics && window.analytics.q;
  const noop = function () {};
  const doNotTrack = nav.doNotTrack === "1" || window.doNotTrack === "1" || nav.msDoNotTrack === "1";
  if (!API_KEY || doNotTrack) {
    window.analytics = { track: noop, flush: noop, _loaded: true };
    return;
  }

  // --- storage (tolerante a modo privado / storage bloqueado) ---------------

  const memory = {};
  function load(storage, key) {
    try {
      const raw = window[storage].getItem(key);
      return raw === null ? memory[key] : JSON.parse(raw);
    } catch (e) {
      return memory[key];
    }
  }
  function save(storage, key, value) {
    memory[key] = value;
    try {
      window[storage].setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }

  let visitorId = load("localStorage", K_VISITOR);
  if (!visitorId) save("localStorage", K_VISITOR, (visitorId = uuid()));

  // --- configuración del sitio ---------------------------------------------------

  // Sin configuración todavía (primera visita): se captura todo, sin reglas.
  let config = { auto: {}, scroll: [25, 50, 75, 100], exclude: [], rules: [] };
  const cached = load("localStorage", K_CONFIG);
  if (cached && cached.c) config = cached.c;

  function on(name) {
    return config.auto[name] !== false;
  }

  function urlMatches(match, value, path) {
    if (!match) return true;
    if (match === "equals") return path === value;
    if (match === "contains") return path.indexOf(value) >= 0;
    if (match === "starts_with") return path.indexOf(value) === 0;
    try {
      return new RegExp(value).test(path);
    } catch (e) {
      return false;
    }
  }

  // "/admin*" excluye /admin y todo lo que cuelga; sin * es la ruta exacta.
  function excluded(path) {
    return config.exclude.some(function (rule) {
      return rule.slice(-1) === "*" ? path.indexOf(rule.slice(0, -1)) === 0 : path === rule;
    });
  }

  function rulesFor(kind) {
    const path = page ? page.path : location.pathname;
    return config.rules.filter(function (rule) {
      return rule.k === kind && urlMatches(rule.m, rule.v, path);
    });
  }

  if (!cached || Date.now() - cached.t > CONFIG_TTL) {
    fetch(BASE + "/api/track/config/?key=" + encodeURIComponent(API_KEY), { credentials: "omit" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (fresh) {
        if (!fresh || !fresh.auto) return;
        config = fresh;
        save("localStorage", K_CONFIG, { t: Date.now(), c: fresh });
        if (page) pageRules(); // la página actual ya arrancó con la configuración anterior
      })
      .catch(function () {});
  }

  // --- atribución y sesión ---------------------------------------------------

  function referrerDomain() {
    try {
      const host = new URL(document.referrer).hostname;
      return host && host !== location.hostname ? host.replace(/^www\./, "") : "";
    } catch (e) {
      return "";
    }
  }

  function urlAttribution() {
    const params = new URLSearchParams(location.search);
    const result = {};
    UTM_KEYS.forEach(function (key) {
      const value = params.get(key);
      if (value) result[key] = value;
    });
    const referrer = referrerDomain();
    if (referrer) result.referrer = referrer;
    return result;
  }

  const campaignOf = function (a) {
    return (a.utm_source || "") + "|" + (a.utm_campaign || "");
  };

  let session = null;
  let page = null;
  let attribution = {};

  function startSession(now) {
    const landing = urlAttribution();
    session = { id: uuid(), last: now, pv: 0, c: campaignOf(landing) };
    attribution = landing;
    save("sessionStorage", K_ATTRIBUTION, { sid: session.id, a: attribution });
    save("localStorage", K_SESSION, session);
    enqueue("session_start", { landing_page: location.pathname });
  }

  // passive: para eventos de salida; no abre una sesión nueva ni extiende la actual.
  function currentSession(passive) {
    const now = Date.now();
    session = load("localStorage", K_SESSION);
    if (passive && session) return session;
    if (!session || now - session.last > SESSION_TIMEOUT) {
      startSession(now);
    } else {
      const stored = load("sessionStorage", K_ATTRIBUTION);
      attribution = stored && stored.sid === session.id ? stored.a : {};
      session.last = now;
      save("localStorage", K_SESSION, session);
    }
    return session;
  }

  // --- cola y envío ----------------------------------------------------------

  let queue = load("localStorage", K_RETRY) || []; // reintentos que quedaron de otra visita
  save("localStorage", K_RETRY, []);
  let retry = [];
  let failures = 0;
  let retryAt = 0;

  function enqueue(name, props) {
    const event = {
      event_name: name,
      visitor_id: visitorId,
      session_id: session.id,
      timestamp: new Date().toISOString(),
      // La página a la que pertenece el evento (en SPA, location ya puede ser la ruta nueva).
      page: page ? page.path : location.pathname,
      properties: Object.assign({}, attribution, props),
    };
    if (DEBUG) console.log("[analytics]", name, event.properties);
    queue.push(event);
  }

  function track(name, props, exit) {
    if (excluded(page ? page.path : location.pathname)) return;
    currentSession(exit);
    enqueue(name, props || {});
    if (exit) flush(true);
    else if (queue.length >= BATCH_SIZE) flush();
  }

  function keepForRetry(events) {
    retry = retry.concat(events).slice(-MAX_RETRY);
    save("localStorage", K_RETRY, retry);
  }

  function post(events, body) {
    fetch(ENDPOINT, { method: "POST", body: body, keepalive: body.length < 60000, credentials: "omit" })
      .then(function (response) {
        // 4xx no se reintenta: el lote nunca va a entrar.
        if (response.status >= 500 || response.status === 429) throw 0;
        failures = 0;
      })
      .catch(function () {
        failures++;
        retryAt = Date.now() + Math.min(60000, FLUSH_INTERVAL * Math.pow(2, failures));
        keepForRetry(events);
      });
  }

  // fetch con keepalive sobrevive a la salida de la página igual que sendBeacon, pero manda Origin
  // siempre (Safari en iOS lo omite en beacons) y avisa si falla, así el lote queda para reintentar.
  const KEEPALIVE = (function () {
    try {
      return "keepalive" in new Request("");
    } catch (e) {
      return false;
    }
  })();

  // beacon: sólo en salida. Envía body text/plain, que no requiere preflight CORS.
  function flush(beacon) {
    let events = queue;
    queue = [];
    if (!beacon && retry.length && Date.now() >= retryAt) {
      events = retry.concat(events);
      retry = [];
      save("localStorage", K_RETRY, []);
    }
    for (let i = 0; i < events.length; i += MAX_PER_REQUEST) {
      const chunk = events.slice(i, i + MAX_PER_REQUEST);
      const body = JSON.stringify({ api_key: API_KEY, events: chunk });
      if (beacon && nav.sendBeacon && !(KEEPALIVE && body.length < 60000)) {
        if (!nav.sendBeacon(ENDPOINT, body)) keepForRetry(chunk);
      } else {
        post(chunk, body);
      }
    }
  }

  // --- ciclo de vida de la página -----------------------------------------------

  function visibleSeconds() {
    const running = document.visibilityState === "visible" ? Date.now() - page.shownAt : 0;
    return Math.round((page.visibleMs + running) / 1000);
  }

  function startPage() {
    page = { path: location.pathname, shownAt: Date.now(), visibleMs: 0, depth: 0, interacted: false, ended: false, fired: {} };
    if (excluded(page.path)) return; // ni sesión ni visita: la ruta no se mide
    const s = currentSession();
    s.pv++;
    save("localStorage", K_SESSION, s);
    track("page_view", { title: document.title, screen_width: screen.width });
    pageRules();
  }

  // Una regla dispara una sola vez por página vista.
  function fire(rule, props) {
    const key = rule.k + rule.e + (rule.t || "") + (rule.s || "");
    if (rule.k !== "click" && rule.k !== "form") {
      if (page.fired[key]) return;
      page.fired[key] = 1;
    }
    track(rule.e, props || {}, rule.k === "form");
  }

  function pageRules() {
    rulesFor("pageview").forEach(function (rule) {
      fire(rule);
    });
  }

  // exit: el usuario deja el sitio. Un cambio de ruta en SPA no es rebote.
  function endPage(exit) {
    if (!page || page.ended) return;
    page.ended = true;
    const seconds = visibleSeconds();
    if (on("time_on_page")) track("time_on_page", { seconds: seconds }, exit);
    const s = load("localStorage", K_SESSION);
    if (on("bounce") && exit && !page.interacted && seconds < BOUNCE_SECONDS && s && s.pv === 1) {
      track("bounce", { seconds: seconds }, true);
    }
  }

  function onRouteChange() {
    if (page && location.pathname !== page.path) {
      endPage();
      startPage();
    }
  }

  ["pushState", "replaceState"].forEach(function (method) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      onRouteChange();
      return result;
    };
  });
  window.addEventListener("popstate", onRouteChange);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      page.visibleMs += Date.now() - page.shownAt;
      flush(true); // en mobile la pestaña puede morir estando oculta
    } else {
      page.shownAt = Date.now();
    }
  });

  function onExit() {
    endPage(true);
    flush(true);
  }
  window.addEventListener("pagehide", onExit);
  window.addEventListener("beforeunload", onExit);
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) startPage(); // volvió desde el bfcache
  });

  // --- interacción -------------------------------------------------------------

  function markInteraction() {
    if (page) page.interacted = true;
  }
  ["keydown", "touchstart"].forEach(function (type) {
    document.addEventListener(type, markInteraction, { capture: true, passive: true });
  });

  let scrollScheduled = false;
  window.addEventListener(
    "scroll",
    function () {
      markInteraction();
      if (scrollScheduled) return;
      scrollScheduled = true;
      requestAnimationFrame(function () {
        scrollScheduled = false;
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const percent = scrollable <= 0 ? 100 : (window.scrollY / scrollable) * 100;
        config.scroll.forEach(function (mark) {
          if (percent >= mark - 1 && page.depth < mark) {
            page.depth = mark;
            if (on("scroll_depth")) track("scroll_depth", { depth_percent: mark });
          }
        });
        rulesFor("scroll").forEach(function (rule) {
          if (percent >= rule.t - 1) fire(rule, { depth_percent: rule.t });
        });
      });
    },
    { passive: true }
  );

  function describe(el) {
    let text = el.tagName.toLowerCase();
    if (el.id) text += "#" + el.id;
    if (typeof el.className === "string" && el.className.trim()) {
      text += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    }
    return text.slice(0, 100);
  }

  function trackAttributes(el) {
    const props = {};
    Object.keys(el.dataset).forEach(function (key) {
      if (key.indexOf("track") === 0 && key.length > 5) {
        // data-track-button-color -> dataset.trackButtonColor -> button_color
        props[key.slice(5).replace(/[A-Z]/g, function (m, i) { return (i ? "_" : "") + m.toLowerCase(); })] = el.dataset[key];
      }
    });
    return props;
  }

  let recentClicks = [];
  document.addEventListener(
    "click",
    function (event) {
      markInteraction();
      const el = event.target instanceof Element ? event.target : null;
      if (!el) return;

      const now = Date.now();
      recentClicks = recentClicks.filter(function (c) {
        return c.el === el && now - c.t < 1000;
      });
      recentClicks.push({ el: el, t: now });
      if (recentClicks.length === 3 && on("rage_click")) track("rage_click", { element: describe(el) });

      const link = el.closest("a[href]");
      const external = link && /^https?:$/.test(link.protocol) && link.hostname !== location.hostname;
      const download = link && DOWNLOAD_RE.test(link.pathname);
      const target = el.closest("a,button,[role=button],input[type=submit],input[type=button],[data-track]");
      if (target && on("click")) {
        const props = { element: describe(target), text: (target.innerText || target.textContent || target.value || target.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 80) };
        if (link) props.href = link.getAttribute("href").slice(0, 300);
        track("click", props);
      }
      const declared = el.closest("[data-track]");
      if (declared) track(declared.getAttribute("data-track"), trackAttributes(declared), !!link);
      rulesFor("click").forEach(function (rule) {
        try {
          if (el.closest(rule.s)) fire(rule);
        } catch (e) {} // selector inválido: se ignora la regla, no el resto
      });
      if (download && on("file_download")) {
        track("file_download", { file_url: link.href.split("?")[0], extension: link.pathname.split(".").pop().toLowerCase() }, true);
      } else if (external && on("outbound_click")) {
        track("outbound_click", { target_url: link.href }, true);
      }
    },
    true
  );

  document.addEventListener(
    "submit",
    function (event) {
      const form = event.target;
      const formId = form.id || form.getAttribute("name") || form.getAttribute("action") || "";
      rulesFor("form").forEach(function (rule) {
        try {
          if (!rule.s || form.matches(rule.s)) fire(rule, { form_id: formId });
        } catch (e) {}
      });
      if (on("form_submit")) track("form_submit", { form_id: formId }, true);
    },
    true
  );

  // --- video ---------------------------------------------------------------------

  function watchVideo(video) {
    if (video._an || !on("video")) return;
    video._an = {};
    const props = function (extra) {
      const src = (video.currentSrc || video.src || "").split("?")[0].split("/").pop();
      return Object.assign(
        { video_id: video.id || video.getAttribute("data-video-id") || src, position_seconds: Math.round(video.currentTime) },
        extra
      );
    };
    video.addEventListener("play", function () {
      track("video_play", props());
    });
    video.addEventListener("timeupdate", function () {
      if (!video.duration) return;
      const percent = (video.currentTime / video.duration) * 100;
      [25, 50, 75].forEach(function (mark) {
        if (percent >= mark && !video._an[mark]) {
          video._an[mark] = 1;
          track("video_progress", props({ percent: mark }));
        }
      });
    });
    video.addEventListener("ended", function () {
      track("video_complete", props());
      video._an = {}; // si lo vuelven a ver, se trackea de nuevo
    });
  }

  function scanVideos(root) {
    if (root.tagName === "VIDEO") watchVideo(root);
    if (root.querySelectorAll) root.querySelectorAll("video").forEach(watchVideo);
  }

  // --- arranque --------------------------------------------------------------------

  // Un link de campaña nuevo abre sesión nueva aunque la anterior siga activa.
  const stored = load("localStorage", K_SESSION);
  const landing = urlAttribution();
  if (stored && landing.utm_source && campaignOf(landing) !== stored.c) {
    save("localStorage", K_SESSION, null);
  }

  startPage();
  scanVideos(document);
  new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) scanVideos(node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(flush, FLUSH_INTERVAL);
  // Reglas de tiempo: segundos con la página visible.
  setInterval(function () {
    if (!page || page.ended) return;
    const seconds = visibleSeconds();
    rulesFor("time").forEach(function (rule) {
      if (seconds >= rule.t) fire(rule, { seconds: rule.t });
    });
  }, 1000);

  const api = {
    track: function (name, props) {
      if (typeof name === "string" && name) track(name, props && typeof props === "object" ? props : {});
    },
    flush: function () {
      flush();
    },
    _loaded: true,
  };
  window.analytics = api;
  if (pending) pending.forEach(function (args) {
    api.track(args[0], args[1]);
  });
})(window, document);
