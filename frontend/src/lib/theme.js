/**
 * Tema de la instalación: color de marca -> tokens de acento para modo claro y
 * oscuro, con contraste garantizado. Un color neón (legible sobre negro) se
 * oscurece automáticamente para el modo claro.
 */

const LIGHT_SURFACE = "#ffffff";
const DARK_SURFACE = "#12151c";
const INK_DARK = "#0b0b0f";

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

export function mix(from, to, amount) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * amount));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mueve el color hacia `toward` en pasos chicos hasta alcanzar el contraste pedido. */
function untilReadable(color, background, target, toward) {
  let result = color;
  for (let t = 0; t <= 1 && contrast(result, background) < target; t += 0.02) {
    result = mix(color, toward, t);
  }
  return result;
}

const inkFor = (background) => (luminance(background) > 0.4 ? INK_DARK : "#ffffff");

function tokens(accent, surface, washBase, rampFrom, rampTo) {
  return {
    "--accent": accent,
    "--accent-hover": mix(accent, luminance(surface) > 0.5 ? "#000000" : "#ffffff", 0.14),
    "--accent-ink": inkFor(accent),
    "--accent-wash": mix(washBase, accent, 0.16),
    "--chart-accent": accent,
    // Rampa secuencial de un solo tono: del fondo al acento (y más allá) para el heatmap.
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`--seq-${i}`, i === 0 ? rampFrom : mix(rampFrom, rampTo, i / 7)])),
  };
}

export function brandTokens(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || "")) return null;
  const onDark = untilReadable(color, DARK_SURFACE, 4.5, "#ffffff");
  const onLight = untilReadable(color, LIGHT_SURFACE, 4.5, "#000000");
  return {
    light: tokens(onLight, LIGHT_SURFACE, LIGHT_SURFACE, "#eef1f4", mix(onLight, "#000000", 0.35)),
    dark: tokens(onDark, DARK_SURFACE, DARK_SURFACE, "#1d222c", onDark),
    onDark,
  };
}

const declarations = (map) => Object.entries(map).map(([k, v]) => `${k}:${v};`).join("");

export function applyBrand(brand) {
  document.getElementById("brand-theme")?.remove();
  if (brand?.name) document.title = brand.name;
  const t = brandTokens(brand?.color);
  if (!t) return;
  const style = document.createElement("style");
  style.id = "brand-theme";
  style.textContent = [
    `:root{${declarations(t.light)}--accent-on-dark:${t.onDark};--accent-ink-on-dark:${inkFor(t.onDark)};` +
      `--accent-fill:${brand.color};--accent-fill-hover:${mix(brand.color, "#000000", 0.08)};--accent-fill-ink:${inkFor(brand.color)};}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${declarations(t.dark)}}}`,
    `:root[data-theme="dark"]{${declarations(t.dark)}}`,
  ].join("\n");
  document.head.appendChild(style);
  window.dispatchEvent(new Event("theme:change"));
}

/** mode: "system" | "light" | "dark" */
export function applyThemeMode(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.dataset.theme = mode;
  else delete root.dataset.theme;
  window.dispatchEvent(new Event("theme:change"));
}
