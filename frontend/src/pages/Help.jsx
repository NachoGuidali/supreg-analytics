import { useMemo, useState } from "react";
import { Link } from "react-router";

import { CopyButton, Field, PageHeader, Panel } from "../components/ui";

const GLOSSARY = [
  ["Visitante único", "Una persona (un navegador). Se reconoce con un identificador anónimo guardado en su navegador; si borra los datos o cambia de dispositivo, cuenta como otra."],
  ["Sesión", "Una visita: empieza con la primera página y termina después de 30 minutos sin actividad. Un link de campaña nuevo abre otra sesión."],
  ["Página vista", "Cada vez que se carga una página, incluidos los cambios de ruta en sitios hechos con React, Vue o similares."],
  ["Tasa de rebote", "Porcentaje de sesiones que se fueron en menos de 10 segundos, sin interactuar y sin ver otra página."],
  ["Duración media", "Tiempo promedio entre el primer y el último evento de cada sesión."],
  ["Alcance de scroll", "Qué parte de las páginas vistas llegó a cada punto (25%, 50%…) del contenido."],
  ["Canal", "El tipo de origen de una sesión: buscadores, redes, publicidad, email, otras campañas, otros sitios o directo."],
  ["UTM", "Etiquetas que se agregan a un link (utm_source, utm_medium, utm_campaign) para saber de qué campaña vino cada visita."],
  ["Evento", "Algo que pasa en la web: una página vista, un click, un scroll, un formulario. Tiene un nombre y propiedades."],
  ["Propiedad", "Un dato extra de un evento, como el texto del botón clickeado o el porcentaje de scroll."],
  ["Objetivo y conversión", "Un objetivo es el evento que te importa (un click en WhatsApp, por ejemplo). Cada persona que lo cumple es una conversión."],
  ["Tasa de conversión", "Visitantes que cumplieron el objetivo sobre el total de visitantes del período."],
  ["Embudo", "Una secuencia de pasos (ver producto, scrollear, escribir). Muestra cuántos avanzan y dónde se caen."],
  ["Retención", "Qué porcentaje de quienes vinieron una semana (o un día) vuelve en los períodos siguientes."],
];

const RECIPES = [
  {
    title: "Contar los clicks en WhatsApp",
    steps: ["Entrá a Captura de datos y creá un evento sin código.", "Elegí Click y el atajo «Links a WhatsApp» (a[href*='wa.me']).", "Usá ese evento como objetivo para ver la tasa de conversión."],
    link: { to: "/captura", label: "Ir a Captura de datos" },
  },
  {
    title: "Saber cuántos llegan a la página de gracias",
    steps: ["Creá un evento sin código del tipo Visita a una página.", "Elegí «Es igual a» y escribí la ruta, por ejemplo /gracias.", "Creá un objetivo con ese evento."],
    link: { to: "/captura", label: "Ir a Captura de datos" },
  },
  {
    title: "Medir un botón puntual",
    steps: ["En tu web, clic derecho sobre el botón y Inspeccionar.", "Copiá su id (se escribe #id) o una clase (.clase).", "Creá un evento de tipo Click con ese selector."],
    link: { to: "/captura", label: "Ir a Captura de datos" },
  },
  {
    title: "Ver qué campaña trae más ventas",
    steps: ["Etiquetá cada link que compartís con el generador de links de abajo.", "Definí un objetivo.", "En Objetivos vas a ver las conversiones por canal, y en Adquisición, cada campaña."],
    link: { to: "/objetivos", label: "Ir a Objetivos" },
  },
  {
    title: "Saber si leen tus artículos",
    steps: ["En Comportamiento, elegí la página del artículo.", "Mirá «Hasta dónde scrollean» y el tiempo medio.", "Para usarlo en embudos, creá un evento sin código de Scroll al 75% en /blog/."],
    link: { to: "/comportamiento", label: "Ir a Comportamiento" },
  },
];

const FAQ = [
  ["Instalé el snippet y no veo datos", "Abrí tu sitio en otra pestaña y mirá Eventos en vivo (se actualiza cada 10 segundos). Si no aparece nada: revisá que el snippet esté antes de </head> en todas las páginas, que el dominio del sitio coincida con el de tu web, y que no tengas activada la opción «No rastrear» del navegador (el script la respeta)."],
  ["¿Cuánto tardan en aparecer los datos?", "Los eventos llegan en segundos. Los cambios de Captura de datos tardan hasta 5 minutos en aplicarse en la web, porque el script guarda la configuración un rato para cargar más rápido."],
  ["¿Por qué los números no coinciden con Google Analytics?", "Cada herramienta cuenta distinto: acá se descartan bots y navegadores automáticos, se respeta «No rastrear», y las sesiones se cortan a los 30 minutos. Las tendencias deberían coincidir aunque los totales difieran."],
  ["¿Necesito un aviso de cookies?", "El script no usa cookies ni guarda la IP: usa un identificador anónimo en el almacenamiento del navegador. Igual conviene mencionarlo en tu política de privacidad."],
  ["¿Puedo dejar de medir algunas páginas?", "Sí: en Captura de datos agregá la ruta en «Páginas que no se miden». Por ejemplo /admin* para todo el panel de administración."],
  ["¿Quién puede ver y cambiar qué?", "Los lectores ven todo; los editores además guardan análisis, dashboards, objetivos y configuran la captura; los dueños gestionan los sitios y el equipo."],
];

function UtmBuilder() {
  const [values, setValues] = useState({ url: "", source: "", medium: "", campaign: "", content: "" });
  const set = (key) => (e) => setValues({ ...values, [key]: e.target.value });
  const link = useMemo(() => {
    if (!values.url.trim()) return "";
    try {
      const url = new URL(values.url.trim().includes("://") ? values.url.trim() : `https://${values.url.trim()}`);
      for (const key of ["source", "medium", "campaign", "content"]) {
        const value = values[key].trim().toLowerCase().replace(/\s+/g, "-");
        if (value) url.searchParams.set(`utm_${key}`, value);
      }
      return url.toString();
    } catch {
      return "";
    }
  }, [values]);
  return (
    <Panel title="Generador de links con UTM" description="Etiquetá los links que compartís para saber qué campaña trae cada visita">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Dirección de tu página" className="sm:col-span-2">
          <input value={values.url} onChange={set("url")} className="w-full" placeholder="https://mitienda.com/productos" />
        </Field>
        <Field label="Fuente (utm_source)" hint="Dónde lo publicás: instagram, facebook, newsletter">
          <input value={values.source} onChange={set("source")} className="w-full" placeholder="instagram" />
        </Field>
        <Field label="Medio (utm_medium)" hint="Tipo: social, cpc (anuncio pago), email">
          <input value={values.medium} onChange={set("medium")} className="w-full" placeholder="social" />
        </Field>
        <Field label="Campaña (utm_campaign)">
          <input value={values.campaign} onChange={set("campaign")} className="w-full" placeholder="promo-octubre" />
        </Field>
        <Field label="Contenido (utm_content, opcional)" hint="Para distinguir piezas: historia, carrusel">
          <input value={values.content} onChange={set("content")} className="w-full" placeholder="historia" />
        </Field>
      </div>
      {link && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2/70 p-3">
          <code className="min-w-0 flex-1 break-all text-[13px]">{link}</code>
          <CopyButton text={link} />
        </div>
      )}
    </Panel>
  );
}

export default function Help() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (...texts) => !q || texts.join(" ").toLowerCase().includes(q);

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader
        title="Ayuda"
        description="Qué significa cada número y cómo medir lo que te importa."
        actions={<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en la ayuda" aria-label="Buscar en la ayuda" className="w-64" />}
      />

      <section aria-labelledby="recetas" className="space-y-3">
        <h2 id="recetas" className="text-lg font-semibold tracking-tight">Cómo medir…</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {RECIPES.filter((r) => matches(r.title, ...r.steps)).map((recipe) => (
            <article key={recipe.title} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <h3 className="text-[16px] font-semibold tracking-tight">{recipe.title}</h3>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2 marker:text-muted">
                {recipe.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <Link to={recipe.link.to} className="mt-3 inline-block text-[13px] font-medium text-accent underline-offset-2 hover:underline">{recipe.link.label}</Link>
            </article>
          ))}
        </div>
      </section>

      {matches("utm link campaña generador") && <UtmBuilder />}

      <Panel title="Glosario" description="Las métricas, en criollo">
        <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          {GLOSSARY.filter(([term, text]) => matches(term, text)).map(([term, text]) => (
            <div key={term}>
              <dt className="text-sm font-semibold">{term}</dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-ink-2">{text}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title="Preguntas frecuentes">
        <div className="divide-y divide-line">
          {FAQ.filter(([question, answer]) => matches(question, answer)).map(([question, answer]) => (
            <details key={question} className="group py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                {question}
                <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-2">{answer}</p>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  );
}
