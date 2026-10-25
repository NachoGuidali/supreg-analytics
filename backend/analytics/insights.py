"""Mejoras: hallazgos automáticos sobre el tráfico de un sitio, cada uno con una acción.

Reglas simples y explicables (no un modelo opaco): cada hallazgo dice qué se midió,
contra qué se comparó y qué conviene hacer. Los umbrales mínimos de volumen evitan
conclusiones sobre tres visitas.
"""

import statistics
from datetime import timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone

from tracking.models import Event

from .engine.aggregation import percent
from .engine.dates import DateRange
from .models import Goal
from .params import change_percent
from .reports import CHANNELS, _sessions, acquisition, audience, behavior

SEVERITY_ORDER = {"critical": 0, "warning": 1, "positive": 2, "tip": 3, "info": 4}
WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def _fmt_pct(value):
    return f"{value:.0f}%".replace(".", ",")


def _insight(key, kind, title, body, action=None, metric=None):
    return {"key": key, "kind": kind, "title": title, "body": body, "action": action, "metric": metric}


def tracking_health(site):
    last = Event.objects.filter(site=site).order_by("-timestamp").values_list("timestamp", flat=True).first()
    if last is None:
        return [_insight(
            "no_data", "critical", "Todavía no llegan datos de este sitio",
            "Pegá el snippet en todas las páginas, antes de </head>. Apenas llegue la primera visita la vas a ver en Eventos en vivo.",
            {"label": "Ver instalación", "to": "/instalacion"},
        )]
    if timezone.now() - last > timedelta(hours=24):
        hours = int((timezone.now() - last).total_seconds() // 3600)
        return [_insight(
            "stale", "critical", "Dejaron de llegar datos",
            f"El último evento llegó hace {hours} horas. Revisá que el snippet siga en la web (un cambio de plantilla suele borrarlo) "
            "y que el dominio del sitio sea el correcto.",
            {"label": "Ver instalación", "to": "/instalacion"},
        )]
    return []


def traffic(site, current, previous):
    found = []
    now_count = _sessions(site, current).values("visitor_id").distinct().count()
    before = _sessions(site, previous).values("visitor_id").distinct().count()
    change = change_percent(now_count, before)
    if change is not None and before >= 20 and abs(change) >= 15:
        up = change > 0
        found.append(_insight(
            "traffic_change", "positive" if up else "warning",
            f"{'Subieron' if up else 'Bajaron'} las visitas un {_fmt_pct(abs(change))}",
            f"{now_count} visitantes únicos contra {before} en el período anterior. "
            + ("Mirá en Adquisición qué canal explica la suba para reforzarlo." if up
               else "Mirá en Adquisición qué canal cayó: una campaña que terminó o un cambio en buscadores suelen ser la causa."),
            {"label": "Ver adquisición", "to": "/adquisicion"},
            {"label": "Visitantes únicos", "value": now_count, "change_percent": change},
        ))

    # Picos y caídas diarias respecto del promedio del período.
    daily = dict(
        _sessions(site, current).annotate(day=TruncDate("started_at", tzinfo=current.tz))
        .values("day").annotate(n=Count("id")).values_list("day", "n")
    )
    today = timezone.now().astimezone(current.tz).date()
    days = [current.date_from + timedelta(days=i) for i in range(current.days) if current.date_from + timedelta(days=i) < today]
    values = [daily.get(d, 0) for d in days]
    if len(values) >= 7 and statistics.mean(values) >= 5:
        mean, stdev = statistics.mean(values), statistics.pstdev(values)
        if stdev > 0:
            peak_day = max(days, key=lambda d: daily.get(d, 0))
            z = (daily.get(peak_day, 0) - mean) / stdev
            if z >= 2.5:
                top = (
                    _sessions(site, DateRange(peak_day, peak_day, current.tz))
                    .values("utm_source", "referrer").annotate(n=Count("id")).order_by("-n").first()
                )
                origin = (top and (top["utm_source"] or top["referrer"])) or "tráfico directo"
                found.append(_insight(
                    "spike", "positive", f"Pico de visitas el {peak_day.strftime('%d/%m')}",
                    f"{daily[peak_day]} sesiones, {f'{daily[peak_day] / mean:.1f}'.replace('.', ',')} veces el promedio diario. "
                    f"La mayor parte llegó desde {origin}. Si fue una publicación o campaña, vale repetirla.",
                    {"label": "Ver adquisición", "to": "/adquisicion"},
                ))
    return found


def sources(site, current, previous):
    now = {r["source"]: r for r in acquisition(site, current)["sources"]}
    before = {r["source"]: r for r in acquisition(site, previous)["sources"]}
    best, best_gain = None, 0
    for source, row in now.items():
        if source == "(directo)":
            continue
        prev = before.get(source, {}).get("sessions", 0)
        gain = row["sessions"] - prev
        if row["sessions"] >= 10 and gain > best_gain and (prev == 0 or gain / prev >= 0.5):
            best, best_gain = (source, row, prev), gain
    if not best:
        return []
    source, row, prev = best
    return [_insight(
        "growing_source", "positive", f"{source} trae cada vez más visitas",
        f"{row['sessions']} sesiones en este período" + (f", {best_gain} más que el anterior." if prev else ", y no aparecía en el período anterior.")
        + f" Su tasa de rebote es {_fmt_pct(row['bounce_rate'])}.",
        {"label": "Ver adquisición", "to": "/adquisicion"},
    )]


def landing_pages(site, current, data):
    found = []
    pages = [p for p in data["landing_pages"] if p["sessions"] >= 20]
    total = sum(p["sessions"] for p in data["channels"]) if data["channels"] else 0
    avg_bounce = (
        sum(c["bounce_rate"] * c["sessions"] for c in data["channels"]) / total if total else 0
    )
    for page in pages:
        if page["bounce_rate"] >= 65 and page["bounce_rate"] >= avg_bounce + 15:
            found.append(_insight(
                f"bounce:{page['page']}", "warning", f"Mucho rebote al entrar por {page['page']}",
                f"El {_fmt_pct(page['bounce_rate'])} de quienes llegan a esta página se va sin interactuar "
                f"(el promedio del sitio es {_fmt_pct(avg_bounce)}). Revisá que el título y la primera pantalla "
                "cumplan lo que promete el anuncio o el link, y que cargue rápido en el celular.",
                {"label": "Ver comportamiento", "to": f"/comportamiento?pagina={page['page']}"},
            ))
            if len(found) == 2:
                break
    return found


def behavior_findings(site, current):
    found = []
    data = behavior(site, current)
    for rage in data["rage_clicks"][:2]:
        if rage["count"] >= 5:
            found.append(_insight(
                f"rage:{rage['page']}:{rage['element']}", "warning", f"Clicks de frustración en {rage['page']}",
                f"{rage['visitors']} personas hicieron clicks repetidos sobre «{rage['element'] or 'un elemento'}» ({rage['count']} veces). "
                "Suele pasar con algo que parece un botón y no hace nada, o con un botón lento. Probalo en el celular.",
                {"label": "Ver comportamiento", "to": f"/comportamiento?pagina={rage['page']}"},
            ))
    for page in data["pages"][:5]:
        if page["views"] >= 30 and page["scroll_50_rate"] < 35:
            found.append(_insight(
                f"scroll:{page['page']}", "tip", f"Casi nadie llega a la mitad de {page['page']}",
                f"Sólo el {_fmt_pct(page['scroll_50_rate'])} de las visitas pasa del 50% de la página. "
                "Subí lo más importante (precio, botón de contacto, beneficio principal) a la primera pantalla.",
                {"label": "Ver comportamiento", "to": f"/comportamiento?pagina={page['page']}"},
            ))
            break
    return found


def devices(site, current):
    rows = (
        _sessions(site, current).values("visitor__device_type")
        .annotate(n=Count("id"), bounces=Count("id", filter=Q(is_bounce=True)))
    )
    stats = {r["visitor__device_type"]: r for r in rows}
    mobile, desktop = stats.get("mobile"), stats.get("desktop")
    if not (mobile and desktop and mobile["n"] >= 30 and desktop["n"] >= 30):
        return []
    m, d = percent(mobile["bounces"], mobile["n"]), percent(desktop["bounces"], desktop["n"])
    if m - d < 15:
        return []
    return [_insight(
        "mobile_bounce", "warning", "En el celular rebotan mucho más",
        f"Rebote en celular: {_fmt_pct(m)}; en computadora: {_fmt_pct(d)}. Revisá la versión móvil: "
        "tamaño de letra, botones fáciles de tocar, ventanas emergentes que tapan el contenido y velocidad de carga.",
        {"label": "Ver audiencia", "to": "/audiencia"},
    )]


def best_time(site, current):
    data = audience(site, current)
    if data["total_sessions"] < 100:
        return []
    dow, hour = max(((d, h) for d in range(7) for h in range(24)), key=lambda dh: data["heatmap"][dh[0]][dh[1]])
    return [_insight(
        "best_time", "info", f"Tu mejor momento: los {WEEKDAYS[dow]} de {hour} a {hour + 1} h",
        "Es la franja con más sesiones en este período. Buen horario para publicar en redes o mandar newsletters.",
        {"label": "Ver audiencia", "to": "/audiencia"},
    )]


def goals(site, current, previous):
    found = []
    site_goals = list(Goal.objects.filter(site=site))
    if not site_goals:
        return [_insight(
            "no_goals", "tip", "Definí qué cuenta como conversión",
            "Un objetivo (un click en WhatsApp, un formulario enviado, llegar a /gracias) te muestra cuántas visitas "
            "terminan en lo que te importa, y desde qué canal convierten mejor.",
            {"label": "Crear objetivo", "to": "/objetivos"},
        )]
    for goal in site_goals:
        now, before = (goal_conversions(goal, r) for r in (current, previous))
        change = change_percent(now, before)
        if before >= 5 and now == 0:
            found.append(_insight(
                f"goal_zero:{goal.id}", "critical", f"Sin conversiones en «{goal.name}»",
                f"Había {before} en el período anterior y ahora ninguna. Probá el recorrido completo: puede ser un botón roto "
                "o un evento que se dejó de enviar.",
                {"label": "Ver objetivos", "to": "/objetivos"},
            ))
        elif change is not None and before >= 5 and abs(change) >= 25:
            up = change > 0
            found.append(_insight(
                f"goal_change:{goal.id}", "positive" if up else "warning",
                f"«{goal.name}» {'subió' if up else 'bajó'} un {_fmt_pct(abs(change))}",
                f"{now} conversiones contra {before} en el período anterior.",
                {"label": "Ver objetivos", "to": "/objetivos"},
                {"label": goal.name, "value": now, "change_percent": change},
            ))
    # Con varios objetivos que se mueven juntos, alcanza con los dos más fuertes.
    alerts = [i for i in found if i["key"].startswith("goal_zero")]
    changes = sorted((i for i in found if i["key"].startswith("goal_change")),
                     key=lambda i: -abs(i["metric"]["change_percent"]))
    return alerts + changes[:2]


def goal_queryset(goal, date_range):
    queryset = Event.objects.filter(
        site_id=goal.site_id, event_name=goal.event_name, timestamp__gte=date_range.start, timestamp__lt=date_range.end
    )
    if goal.page_contains:
        queryset = queryset.filter(page__icontains=goal.page_contains)
    return queryset


def goal_conversions(goal, date_range):
    """Conversiones = visitantes únicos que hicieron el evento del objetivo."""
    return goal_queryset(goal, date_range).values("visitor_id").distinct().count()


def site_insights(site, current: DateRange):
    previous = current.previous()
    found = tracking_health(site)
    if found and found[0]["key"] == "no_data":
        return found
    acq = acquisition(site, current)
    for producer in (
        lambda: traffic(site, current, previous),
        lambda: goals(site, current, previous),
        lambda: sources(site, current, previous),
        lambda: landing_pages(site, current, acq),
        lambda: behavior_findings(site, current),
        lambda: devices(site, current),
        lambda: best_time(site, current),
    ):
        found.extend(producer())
    if not any(i["kind"] in ("critical", "warning", "positive") for i in found) and acq["total_sessions"]:
        top = acq["channels"][0]
        found.append(_insight(
            "steady", "info", "Todo estable en este período",
            f"No hay cambios fuertes. Tu canal principal es {CHANNELS[top['key']].lower()}, con el {_fmt_pct(top['percent'])} de las sesiones.",
        ))
    return sorted(found, key=lambda i: SEVERITY_ORDER[i["kind"]])
