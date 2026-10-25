const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

// SDK_FILE permite correr los mismos tests contra la versión minificada.
const CODE = fs.readFileSync(path.resolve(__dirname, "..", process.env.SDK_FILE || "src/analytics.js"), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(t, options = {}) {
  const {
    url = "https://shop.test/productos?utm_source=instagram&utm_campaign=sept",
    referrer = "https://www.instagram.com/p/123",
    storage = {},
    dnt = false,
    fetchImpl = () => Promise.resolve({ status: 204 }),
    beforeLoad = () => {},
    body = "",
    config = null, // respuesta de /api/track/config/ (null = 404)
  } = options;
  const dom = new JSDOM(
    `<!doctype html><html><head><title>Productos</title>
     <script src="https://backend.test/static/analytics.js" data-api-key="KEY"></script></head>
     <body>${body}</body></html>`,
    { url, ...(referrer ? { referrer } : {}), pretendToBeVisual: true, runScripts: "outside-only" }
  );
  const w = dom.window;
  t.after(() => w.close());

  const clock = { now: 1_800_000_000_000 };
  w.Date.now = () => clock.now;
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);

  const requests = [];
  const beacons = [];
  const configRequests = [];
  w.fetch = (target, init) => {
    if (target.includes("/api/track/config/")) {
      configRequests.push(target);
      return Promise.resolve({ ok: Boolean(config), json: () => Promise.resolve(config) });
    }
    requests.push({ url: target, init, events: JSON.parse(init.body).events, apiKey: JSON.parse(init.body).api_key });
    return fetchImpl(target, init);
  };
  Object.defineProperty(w.navigator, "sendBeacon", {
    configurable: true,
    value: (target, data) => {
      beacons.push({ url: target, events: JSON.parse(data).events, typeofBody: typeof data });
      return true;
    },
  });
  if (dnt) Object.defineProperty(w.navigator, "doNotTrack", { configurable: true, value: "1" });
  beforeLoad(w);
  w.eval(CODE);

  const all = () => [...requests, ...beacons].flatMap((r) => r.events);
  const flushAndGet = () => {
    w.analytics.flush();
    return all();
  };
  return { dom, w, clock, requests, beacons, configRequests, all, flushAndGet, names: () => flushAndGet().map((e) => e.event_name) };
}

const byName = (events, name) => events.filter((e) => e.event_name === name);

test("carga: session_start + page_view con atribución, en un batch a la API del host del script", (t) => {
  const { flushAndGet, requests, w } = setup(t);
  const events = flushAndGet();

  assert.deepEqual(events.map((e) => e.event_name), ["session_start", "page_view"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://backend.test/api/track/batch/");
  assert.equal(requests[0].apiKey, "KEY");
  assert.equal(requests[0].init.headers, undefined, "sin headers: body string => text/plain, sin preflight");
  assert.equal(requests[0].init.credentials, "omit");

  const [start, pageView] = events;
  assert.equal(start.properties.landing_page, "/productos");
  for (const event of events) {
    assert.equal(event.properties.utm_source, "instagram");
    assert.equal(event.properties.utm_campaign, "sept");
    assert.equal(event.properties.referrer, "instagram.com");
    assert.equal(event.page, "/productos");
  }
  assert.equal(pageView.properties.title, "Productos");
  assert.ok("screen_width" in pageView.properties);
  assert.equal(start.session_id, pageView.session_id);
  assert.equal(w.localStorage.getItem("_an_vid"), JSON.stringify(start.visitor_id));
});

test("visitor persiste; sesión se reutiliza antes de 30 min y se renueva después", (t) => {
  const first = setup(t);
  const firstEvents = first.flushAndGet();
  const storage = { _an_vid: first.w.localStorage.getItem("_an_vid"), _an_ses: first.w.localStorage.getItem("_an_ses") };

  // Otra página del sitio, 10 minutos después, sin UTM.
  const second = setup(t, {
    url: "https://shop.test/contacto", referrer: "https://shop.test/productos", storage,
    beforeLoad: (w) => { w.Date.now = () => first.clock.now + 10 * 60 * 1000; },
  });
  const secondEvents = second.flushAndGet();
  assert.deepEqual(secondEvents.map((e) => e.event_name), ["page_view"]);
  assert.equal(secondEvents[0].visitor_id, firstEvents[0].visitor_id);
  assert.equal(secondEvents[0].session_id, firstEvents[0].session_id);
  assert.equal(secondEvents[0].properties.referrer, undefined, "auto-referencia no es referrer");

  // 31 minutos de inactividad: sesión nueva.
  second.clock.now = first.clock.now + 10 * 60 * 1000;
  second.w.Date.now = () => second.clock.now + 31 * 60 * 1000;
  second.w.analytics.track("click_cta");
  const later = byName(second.flushAndGet(), "click_cta")[0];
  assert.notEqual(later.session_id, firstEvents[0].session_id);
  assert.equal(byName(second.all(), "session_start").length, 1);
});

test("un link de campaña distinta abre sesión nueva aunque la anterior siga activa", (t) => {
  const first = setup(t);
  const firstSession = first.flushAndGet()[0].session_id;
  const storage = { _an_vid: first.w.localStorage.getItem("_an_vid"), _an_ses: first.w.localStorage.getItem("_an_ses") };

  const second = setup(t, { url: "https://shop.test/?utm_source=google&utm_campaign=promo", referrer: "", storage });
  const events = second.flushAndGet();

  assert.deepEqual(events.map((e) => e.event_name), ["session_start", "page_view"]);
  assert.notEqual(events[0].session_id, firstSession);
  assert.equal(events[1].properties.utm_source, "google");
});

test("data-track: atributos data-track-* como propiedades; link externo va por beacon + outbound_click", (t) => {
  const { w, beacons } = setup(t, {
    body: `<a id="wa" href="https://wa.me/549111" data-track="whatsapp_click" data-track-location="header"
              data-track-button-color="green"><span id="inner">WhatsApp</span></a>`,
  });
  w.document.getElementById("inner").click();

  const events = beacons.flatMap((b) => b.events);
  const click = byName(events, "whatsapp_click")[0];
  assert.deepEqual(
    { location: click.properties.location, button_color: click.properties.button_color },
    { location: "header", button_color: "green" }
  );
  assert.equal(byName(events, "outbound_click")[0].properties.target_url, "https://wa.me/549111");
  assert.equal(beacons[0].typeofBody, "string");
});

test("links internos no son outbound_click", (t) => {
  const { w, names } = setup(t, { body: `<a id="l" href="/otra">otra</a>` });
  w.document.getElementById("l").addEventListener("click", (e) => e.preventDefault());
  w.document.getElementById("l").click();
  assert.equal(names().includes("outbound_click"), false);
});

test("rage_click: 3 clicks en <1s en el mismo elemento disparan uno solo", (t) => {
  const { w, clock, flushAndGet } = setup(t, { body: `<button id="b" class="btn primary big">Comprar</button><p id="p">x</p>` });
  const button = w.document.getElementById("b");
  for (let i = 0; i < 5; i++) { clock.now += 150; button.click(); }
  clock.now += 2000;
  button.click(); button.click(); // sólo 2 en la nueva ráfaga
  const rage = byName(flushAndGet(), "rage_click");
  assert.equal(rage.length, 1);
  assert.equal(rage[0].properties.element, "button#b.btn.primary");
});

test("clicks lentos o en elementos distintos no son rage_click", (t) => {
  const { w, clock, flushAndGet } = setup(t, { body: `<button id="a">a</button><button id="b">b</button>` });
  const [a, b] = [w.document.getElementById("a"), w.document.getElementById("b")];
  a.click(); clock.now += 100; b.click(); clock.now += 100; a.click();
  clock.now += 600; a.click(); clock.now += 600; a.click();
  assert.equal(byName(flushAndGet(), "rage_click").length, 0);
});

test("form_submit por beacon, sin valores de campos", (t) => {
  const { w, beacons } = setup(t, { body: `<form id="contacto"><input name="email" value="a@b.c"></form>` });
  const form = w.document.getElementById("contacto");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));

  const submit = byName(beacons.flatMap((b) => b.events), "form_submit")[0];
  assert.equal(submit.properties.form_id, "contacto");
  assert.equal(JSON.stringify(submit).includes("a@b.c"), false);
});

test("scroll_depth dispara cada hito una sola vez", async (t) => {
  const { w, flushAndGet } = setup(t);
  Object.defineProperty(w.document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
  Object.defineProperty(w, "innerHeight", { configurable: true, value: 1000 });
  const scrollTo = async (y) => {
    Object.defineProperty(w, "scrollY", { configurable: true, value: y });
    w.dispatchEvent(new w.Event("scroll"));
    await sleep(40);
  };
  await scrollTo(1100); // 55%
  await scrollTo(900); // vuelve para arriba
  await scrollTo(2000); // 100%
  const depths = byName(flushAndGet(), "scroll_depth").map((e) => e.properties.depth_percent);
  assert.deepEqual(depths, [25, 50, 75, 100]);
});

test("bounce: salida en <10s sin interacción en la primera página", (t) => {
  const { w, clock, beacons } = setup(t);
  clock.now += 4000;
  w.dispatchEvent(new w.Event("pagehide"));
  w.dispatchEvent(new w.Event("beforeunload")); // no duplica

  const events = beacons.flatMap((b) => b.events);
  assert.equal(byName(events, "time_on_page").length, 1);
  assert.equal(byName(events, "time_on_page")[0].properties.seconds, 4);
  assert.equal(byName(events, "bounce").length, 1);
  assert.equal(byName(events, "page_view").length, 1, "la cola pendiente también sale por beacon");
});

test("no hay bounce si hubo interacción, si pasaron 10s o si no es la primera página", (t) => {
  const interacted = setup(t);
  interacted.clock.now += 3000;
  interacted.w.document.dispatchEvent(new interacted.w.KeyboardEvent("keydown"));
  interacted.w.dispatchEvent(new interacted.w.Event("pagehide"));
  assert.equal(byName(interacted.beacons.flatMap((b) => b.events), "bounce").length, 0);

  const slow = setup(t);
  slow.clock.now += 12000;
  slow.w.dispatchEvent(new slow.w.Event("pagehide"));
  assert.equal(byName(slow.beacons.flatMap((b) => b.events), "bounce").length, 0);

  const spa = setup(t);
  spa.w.history.pushState({}, "", "/checkout");
  spa.clock.now += 2000;
  spa.w.dispatchEvent(new spa.w.Event("pagehide"));
  assert.equal(byName(spa.beacons.flatMap((b) => b.events), "bounce").length, 0);
});

test("SPA: pushState cierra la página anterior y registra page_view nueva; replaceState en misma ruta no", (t) => {
  const { w, clock, all, flushAndGet } = setup(t);
  clock.now += 7000;
  w.history.pushState({}, "", "/checkout?step=1");
  w.history.replaceState({}, "", "/checkout?step=2");
  flushAndGet();

  const events = all();
  const timeOnPage = byName(events, "time_on_page");
  assert.equal(timeOnPage.length, 1);
  assert.equal(timeOnPage[0].page, "/productos");
  assert.equal(timeOnPage[0].properties.seconds, 7);
  const pageViews = byName(events, "page_view");
  assert.deepEqual(pageViews.map((e) => e.page), ["/productos", "/checkout"]);
  assert.equal(pageViews[1].properties.utm_source, "instagram", "la atribución acompaña toda la sesión");
});

test("batching: al llegar a 10 eventos se envía sin esperar al intervalo", (t) => {
  const { w, requests } = setup(t);
  for (let i = 0; i < 7; i++) w.analytics.track("e" + i);
  assert.equal(requests.length, 0);
  w.analytics.track("e7"); // session_start + page_view + 8 = 10
  assert.equal(requests.length, 1);
  assert.equal(requests[0].events.length, 10);
});

test("batching: se envía solo cada 5 segundos", async (t) => {
  const { requests } = setup(t);
  assert.equal(requests.length, 0);
  await sleep(5300);
  assert.equal(requests.length, 1);
});

test("reintentos: error de red o 5xx se reintenta con backoff; 4xx se descarta", async (t) => {
  let mode = "network";
  const { w, clock, requests } = setup(t, {
    fetchImpl: () => (mode === "network" ? Promise.reject(new Error("offline"))
      : mode === "500" ? Promise.resolve({ status: 500 }) : mode === "400" ? Promise.resolve({ status: 400 }) : Promise.resolve({ status: 204 })),
  });
  w.analytics.flush();
  await sleep(10);
  assert.deepEqual(JSON.parse(w.localStorage.getItem("_an_retry")).map((e) => e.event_name), ["session_start", "page_view"]);

  // Durante el backoff no se reintenta.
  mode = "ok";
  w.analytics.track("durante_backoff");
  w.analytics.flush();
  assert.deepEqual(requests.at(-1).events.map((e) => e.event_name), ["durante_backoff"]);

  clock.now += 11000;
  w.analytics.flush();
  assert.deepEqual(requests.at(-1).events.map((e) => e.event_name), ["session_start", "page_view"]);
  await sleep(10);
  assert.equal(w.localStorage.getItem("_an_retry"), "[]");

  mode = "400";
  w.analytics.track("rechazado");
  w.analytics.flush();
  await sleep(10);
  clock.now += 120000;
  const count = requests.length;
  w.analytics.flush();
  assert.equal(requests.length, count, "el lote con 400 no vuelve a enviarse");
});

test("los reintentos guardados de una visita anterior se envían al cargar", (t) => {
  const stored = [{ event_name: "viejo", visitor_id: "v", session_id: "s", timestamp: "2026-01-01T00:00:00Z", page: "/", properties: {} }];
  const { names, w } = setup(t, { storage: { _an_retry: JSON.stringify(stored) } });
  assert.deepEqual(names(), ["viejo", "session_start", "page_view"]);
  assert.equal(w.localStorage.getItem("_an_retry"), "[]");
});

test("video: detecta <video> agregados después; play, progreso 25/50/75 y complete", async (t) => {
  const { w, flushAndGet } = setup(t);
  const video = w.document.createElement("video");
  video.id = "demo";
  w.document.body.appendChild(video);
  await sleep(10); // MutationObserver

  let currentTime = 0;
  Object.defineProperty(video, "duration", { configurable: true, value: 100 });
  Object.defineProperty(video, "currentTime", { configurable: true, get: () => currentTime });
  const fire = (type) => video.dispatchEvent(new w.Event(type));
  fire("play");
  for (const time of [10, 30, 55, 60, 80]) { currentTime = time; fire("timeupdate"); }
  currentTime = 100;
  fire("ended");

  const events = flushAndGet().filter((e) => e.event_name.startsWith("video_"));
  assert.deepEqual(events.map((e) => [e.event_name, e.properties.percent]), [
    ["video_play", undefined], ["video_progress", 25], ["video_progress", 50], ["video_progress", 75], ["video_complete", undefined],
  ]);
  assert.equal(events[0].properties.video_id, "demo");
  assert.equal(events[2].properties.position_seconds, 55);
});

test("API programática y llamadas encoladas antes de cargar el script", (t) => {
  const { w, flushAndGet } = setup(t, {
    beforeLoad: (win) => {
      win.analytics = { track: function () { (win.analytics.q = win.analytics.q || []).push(arguments); } };
      win.analytics.track("antes_de_cargar", { origen: "stub" });
    },
  });
  w.analytics.track("video_played", { video_id: "demo", duration: 120 });
  w.analytics.track(""); // ignorado
  const events = flushAndGet();
  assert.deepEqual(byName(events, "antes_de_cargar")[0].properties.origen, "stub");
  assert.equal(byName(events, "video_played")[0].properties.duration, 120);
  assert.equal(events.some((e) => e.event_name === ""), false);
});

test("Do Not Track: no se envía nada y la API no rompe", async (t) => {
  const { w, requests, beacons } = setup(t, { dnt: true });
  w.analytics.track("x");
  w.analytics.flush();
  w.dispatchEvent(new w.Event("pagehide"));
  assert.equal(requests.length + beacons.length, 0);
  assert.equal(w.localStorage.getItem("_an_vid"), null);
});

test("funciona con localStorage bloqueado", (t) => {
  const { names } = setup(t, {
    beforeLoad: (w) => {
      Object.defineProperty(w, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
    },
  });
  assert.deepEqual(names(), ["session_start", "page_view"]);
});

const CONFIG = (overrides = {}) => ({ auto: {}, scroll: [25, 50, 75, 100], exclude: [], rules: [], ...overrides });
const cachedConfig = (config) => ({ _an_cfg: JSON.stringify({ t: 1_800_000_000_000, c: config }) });

test("config: se baja una vez con la api_key y queda en localStorage; con cache vigente no se pide", async (t) => {
  const first = setup(t, { config: CONFIG({ scroll: [50] }) });
  await sleep(10);
  assert.equal(first.configRequests.length, 1);
  assert.equal(first.configRequests[0], "https://backend.test/api/track/config/?key=KEY");
  assert.deepEqual(JSON.parse(first.w.localStorage.getItem("_an_cfg")).c.scroll, [50]);

  const second = setup(t, { storage: cachedConfig(CONFIG()) });
  await sleep(10);
  assert.equal(second.configRequests.length, 0);
});

test("click: botones y links se registran con texto, elemento y destino", (t) => {
  const { w, flushAndGet } = setup(t, {
    body: `<button id="b" class="btn">  Agregar   al carrito </button><a id="l" href="/precios">Ver <b id="in">precios</b></a>`,
  });
  w.document.getElementById("l").addEventListener("click", (e) => e.preventDefault());
  w.document.getElementById("b").click();
  w.document.getElementById("in").click();
  const clicks = byName(flushAndGet(), "click");
  assert.deepEqual(clicks.map((c) => c.properties.text), ["Agregar al carrito", "Ver precios"]);
  assert.equal(clicks[0].properties.element, "button#b.btn");
  assert.equal(clicks[1].properties.href, "/precios");
});

test("descargas: un link a un archivo es file_download (por beacon) y no outbound_click", (t) => {
  const { w, beacons } = setup(t, { body: `<a id="d" href="https://cdn.otro.com/lista.PDF?v=2">Lista</a>` });
  w.document.getElementById("d").click();
  const events = beacons.flatMap((b) => b.events);
  const download = byName(events, "file_download")[0];
  assert.equal(download.properties.file_url, "https://cdn.otro.com/lista.PDF");
  assert.equal(download.properties.extension, "pdf");
  assert.equal(byName(events, "outbound_click").length, 0);
});

test("captura automática apagada desde el dashboard: no se registra", async (t) => {
  const config = CONFIG({ auto: { click: false, scroll_depth: false, outbound_click: false, time_on_page: false } });
  const { w, flushAndGet } = setup(t, {
    storage: cachedConfig(config),
    body: `<button id="b">Comprar</button><a id="x" href="https://otro.com">x</a>`,
  });
  Object.defineProperty(w.document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
  Object.defineProperty(w, "innerHeight", { configurable: true, value: 1000 });
  Object.defineProperty(w, "scrollY", { configurable: true, value: 2000 });
  w.dispatchEvent(new w.Event("scroll"));
  await sleep(40);
  w.document.getElementById("b").click();
  w.document.getElementById("x").click();
  w.dispatchEvent(new w.Event("pagehide"));
  const names = flushAndGet().map((e) => e.event_name);
  for (const name of ["click", "scroll_depth", "outbound_click", "time_on_page"]) assert.equal(names.includes(name), false, name);
  assert.ok(names.includes("page_view"));
});

test("cortes de scroll configurables", async (t) => {
  const { w, flushAndGet } = setup(t, { storage: cachedConfig(CONFIG({ scroll: [10, 90] })) });
  Object.defineProperty(w.document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
  Object.defineProperty(w, "innerHeight", { configurable: true, value: 1000 });
  Object.defineProperty(w, "scrollY", { configurable: true, value: 2000 });
  w.dispatchEvent(new w.Event("scroll"));
  await sleep(40);
  assert.deepEqual(byName(flushAndGet(), "scroll_depth").map((e) => e.properties.depth_percent), [10, 90]);
});

test("reglas sin código: click en un selector, sólo en las páginas indicadas; selector inválido no rompe", (t) => {
  const config = CONFIG({
    rules: [
      { e: "click_whatsapp", k: "click", s: "a[href*='wa.me']" },
      { e: "click_en_precios", k: "click", s: ".cta", m: "starts_with", v: "/precios" },
      { e: "roto", k: "click", s: "a[[[" },
    ],
  });
  const { w, flushAndGet } = setup(t, {
    storage: cachedConfig(config),
    body: `<a id="wa" href="https://wa.me/1"><span id="ico">WA</span></a><button id="cta" class="cta">Comprar</button>`,
  });
  w.document.getElementById("ico").click();
  w.document.getElementById("cta").click();
  const names = flushAndGet().map((e) => e.event_name);
  assert.equal(names.filter((n) => n === "click_whatsapp").length, 1);
  assert.equal(names.includes("click_en_precios"), false, "la página es /productos");
});

test("reglas sin código: visita a una página, aunque la configuración llegue después de cargar", async (t) => {
  const config = CONFIG({ rules: [{ e: "vio_productos", k: "pageview", m: "contains", v: "product" }] });
  const { flushAndGet } = setup(t, { config });
  await sleep(10);
  const events = flushAndGet();
  assert.equal(byName(events, "vio_productos").length, 1);
  assert.equal(byName(events, "vio_productos")[0].page, "/productos");
});

test("reglas sin código: scroll y tiempo disparan una vez por página; formulario con selector", async (t) => {
  const config = CONFIG({
    rules: [
      { e: "leyo_mitad", k: "scroll", t: 50 },
      { e: "se_quedo", k: "time", t: 1 },
      { e: "envio_contacto", k: "form", s: "#contacto" },
      { e: "envio_otro", k: "form", s: "#otro" },
    ],
  });
  const { w, clock, flushAndGet } = setup(t, { storage: cachedConfig(config), body: `<form id="contacto"></form>` });
  Object.defineProperty(w.document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
  Object.defineProperty(w, "innerHeight", { configurable: true, value: 1000 });
  for (const y of [1200, 1500]) {
    Object.defineProperty(w, "scrollY", { configurable: true, value: y });
    w.dispatchEvent(new w.Event("scroll"));
    await sleep(40);
  }
  clock.now += 2000;
  await sleep(1100);
  const form = w.document.getElementById("contacto");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  const names = flushAndGet().map((e) => e.event_name); // incluye lo enviado por beacon
  assert.equal(names.filter((n) => n === "leyo_mitad").length, 1);
  assert.equal(names.filter((n) => n === "se_quedo").length, 1);
  assert.equal(names.filter((n) => n === "envio_contacto").length, 1);
  assert.equal(names.includes("envio_otro"), false);
});

test("rutas excluidas: no se registra nada en ellas", (t) => {
  const { names } = setup(t, { storage: cachedConfig(CONFIG({ exclude: ["/productos*"] })) });
  assert.deepEqual(names(), []);
});

test("salida: con fetch keepalive disponible se usa en vez de sendBeacon", (t) => {
  const { w, requests, beacons } = setup(t, {
    body: `<a id="wa" href="https://wa.me/1">WhatsApp</a>`,
    beforeLoad: (w) => {
      w.Request = function () { this.keepalive = false; };
    },
  });
  w.document.getElementById("wa").click();
  assert.equal(beacons.length, 0);
  const exit = requests.find((r) => r.events.some((e) => e.event_name === "outbound_click"));
  assert.ok(exit, "el outbound_click sale por fetch");
  assert.equal(exit.init.keepalive, true);
  assert.deepEqual(exit.events.map((e) => e.event_name).slice(-2), ["click", "outbound_click"]);
});

test("pesa menos de 10kb minificado", { skip: !process.env.SDK_FILE }, () => {
  const bytes = fs.statSync(path.resolve(__dirname, "..", process.env.SDK_FILE)).size;
  assert.ok(bytes < 10 * 1024, `${bytes} bytes`);
});
