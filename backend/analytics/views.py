from collections import defaultdict
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import connection
from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Max, Q
from django.db.models.functions import JSONObject, TruncDate
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.access import get_site
from accounts.models import Role
from accounts.scoped import SiteScopedViewSet
from sites.tracking import AUTO_EVENTS, RESERVED_EVENTS
from tracking.models import Event, Session

from . import insights, reports
from .engine import run_analysis
from .engine.aggregation import percent
from .engine.fields import COLUMN_FIELDS
from .engine.filters import OPERATORS_BY_TYPE
from .models import Dashboard, EventDefinition, Goal, SavedAnalysis
from .params import change_percent, resolve_date_range
from .serializers import (
    DashboardSerializer, EventDefinitionSerializer, GoalSerializer, RunAnalysisSerializer, SavedAnalysisSerializer,
)


def _int_param(params, name, default, minimum, maximum):
    value = params.get(name)
    if value in (None, ""):
        return default
    try:
        number = int(value)
    except ValueError:
        raise ValidationError({name: "Debe ser un entero."}) from None
    if not minimum <= number <= maximum:
        raise ValidationError({name: f"Debe estar entre {minimum} y {maximum}."})
    return number


def _run(site, analysis_type, config, date_from, date_to):
    date_range = resolve_date_range(site, date_from, date_to)
    return run_analysis(site, analysis_type, config, date_range.date_from, date_range.date_to)


class RunAnalysisView(APIView):
    """POST /api/analysis/run/ — ejecuta una config sin guardarla (preview del constructor)."""

    def post(self, request):
        serializer = RunAnalysisSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        site = get_site(request.user, data["site_id"])
        return Response(_run(site, data["analysis_type"], data["config"], data.get("date_from"), data.get("date_to")))


class SavedAnalysisViewSet(SiteScopedViewSet):
    """CRUD de /api/analyses/. Filtros: ?site_id= y ?is_pinned=true.

    Leer y ejecutar: cualquier rol. Crear, modificar y borrar: editor o dueño.
    """

    model = SavedAnalysis
    serializer_class = SavedAnalysisSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == "run":
            queryset = queryset.select_related("site")
        if self.request.query_params.get("is_pinned") in ("true", "1"):
            queryset = queryset.filter(is_pinned=True)
        return queryset

    @action(detail=True, methods=["get"])
    def run(self, request, pk=None):
        """GET /api/analyses/{id}/run/?date_from=&date_to="""
        analysis = self.get_object()
        result = _run(
            analysis.site, analysis.analysis_type, analysis.config,
            request.query_params.get("date_from"), request.query_params.get("date_to"),
        )
        return Response({"analysis": {"id": str(analysis.id), "name": analysis.name}, **result})


class EventNamesView(APIView):
    """GET /api/events/names/?site_id=&days=90

    Nombres vistos en los últimos `days` días, del más frecuente al menos. Limitar
    la ventana mantiene la query acotada y saca del selector eventos abandonados.
    """

    def get(self, request):
        site = get_site(request.user, request.query_params.get("site_id"))
        days = _int_param(request.query_params, "days", 90, 1, 3 * 366)
        rows = (
            Event.objects.filter(site=site, timestamp__gte=timezone.now() - timedelta(days=days))
            .values("event_name")
            .annotate(count=Count("id"), last_seen=Max("timestamp"))
            .order_by("-count", "event_name")
        )
        definitions = {d.event_name: d for d in EventDefinition.objects.filter(site=site)}
        include_hidden = request.query_params.get("include_hidden") in ("1", "true")
        return Response({
            "days": days,
            "event_names": [
                {
                    "name": row["event_name"], "count": row["count"], "last_seen": row["last_seen"],
                    "label": definitions[row["event_name"]].label if row["event_name"] in definitions else "",
                }
                for row in rows
                if include_hidden or not (row["event_name"] in definitions and definitions[row["event_name"]].is_hidden)
            ],
        })


class EventPropertiesView(APIView):
    """GET /api/events/properties/?site_id=&event_name=X&sample=1000

    Campos filtrables para un evento, con tipo y valores más frecuentes, calculados
    sobre los últimos `sample` eventos (usa el índice site/event_name/timestamp).
    Todo el conteo se hace en una sola query en Postgres.
    """

    VALUES_PER_FIELD = 10

    def get(self, request):
        params = request.query_params
        site = get_site(request.user, params.get("site_id"))
        event_name = params.get("event_name")
        if not event_name:
            raise ValidationError({"event_name": "Es obligatorio."})
        sample_size = _int_param(params, "sample", 1000, 1, 5000)

        column_names = [name for name in COLUMN_FIELDS if name != "event_name"]
        sample_sql, sample_params = (
            Event.objects.filter(site=site, event_name=event_name)
            .order_by("-timestamp")
            .annotate(columns=JSONObject(**{name: COLUMN_FIELDS[name][0] for name in column_names}))
            .values("properties", "columns")[:sample_size]
            .query.sql_with_params()
        )
        sql = f"""
            WITH sample AS ({sample_sql}),
            pairs AS (
                SELECT 'properties.' || kv.key AS name, kv.value FROM sample, jsonb_each(sample.properties) kv
                UNION ALL
                SELECT kv.key, kv.value FROM sample, jsonb_each(sample.columns) kv
            ),
            counted AS (
                SELECT name, jsonb_typeof(value) AS type, value #>> '{{}}' AS val, COUNT(*) AS n
                FROM pairs
                WHERE jsonb_typeof(value) IN ('string', 'number', 'boolean') AND value #>> '{{}}' <> ''
                GROUP BY 1, 2, 3
            ),
            ranked AS (
                SELECT name, type, val, n,
                       ROW_NUMBER() OVER (PARTITION BY name ORDER BY n DESC, val) AS rn,
                       SUM(n) OVER (PARTITION BY name) AS present,
                       COUNT(*) OVER (PARTITION BY name) AS distinct_values,
                       SUM(n) OVER (PARTITION BY name, type) AS type_total
                FROM counted
            )
            SELECT (SELECT COUNT(*) FROM sample), name, type, val, n, present, distinct_values, type_total
            FROM ranked WHERE rn <= %s ORDER BY name, rn
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [*sample_params, self.VALUES_PER_FIELD])
            rows = cursor.fetchall()

        sampled = rows[0][0] if rows else 0
        fields = {}
        for _, name, value_type, value, count, present, distinct_values, type_total in rows:
            field = fields.setdefault(name, {
                "name": name, "type_totals": {}, "values": [],
                "coverage": percent(present, sampled), "distinct_values": distinct_values,
            })
            field["type_totals"][value_type] = type_total
            field["values"].append({"value": _typed(value, value_type), "count": count})

        result = []
        for name in column_names:  # las columnas siempre se ofrecen, aunque no tengan datos
            field = fields.pop(name, None) or {"values": [], "coverage": 0.0, "distinct_values": 0}
            result.append(_describe(name, COLUMN_FIELDS[name][2], field, source=COLUMN_FIELDS[name][0].split("__")[0]))
        for name in sorted(fields):
            field = fields[name]
            dominant = max(field["type_totals"], key=field["type_totals"].get)
            result.append(_describe(name, dominant, field, source="properties"))

        return Response({
            "event_name": event_name,
            "sample_size": sampled,
            "fields": result,
            "operators_by_type": OPERATORS_BY_TYPE,
        })


def _typed(value, value_type):
    if value_type == "number":
        number = float(value)
        return int(number) if number.is_integer() else number
    if value_type == "boolean":
        return value == "true"
    return value


def _describe(name, value_type, field, *, source):
    if source not in ("properties", "session", "visitor"):
        source = "event"
    return {
        "name": name,
        "type": value_type,
        "source": source,
        "coverage": field["coverage"],
        "distinct_values": field["distinct_values"],
        "values": field["values"],
    }


class RecentEventsView(APIView):
    """GET /api/events/recent/?site_id=&after_id=&event_name=&limit=50

    Para el explorador en vivo: el frontend hace polling pasando el último id visto.
    """

    def get(self, request):
        params = request.query_params
        site = get_site(request.user, params.get("site_id"))
        limit = _int_param(params, "limit", 50, 1, 200)
        queryset = Event.objects.filter(site=site).select_related("visitor", "session").order_by("-id")
        if params.get("after_id"):
            queryset = queryset.filter(id__gt=_int_param(params, "after_id", 0, 0, 2**63 - 1))
        if params.get("event_name"):
            queryset = queryset.filter(event_name=params["event_name"])

        return Response({
            "events": [
                {
                    "id": event.id,
                    "event_name": event.event_name,
                    "page": event.page,
                    "timestamp": event.timestamp,
                    "received_at": event.received_at,
                    "properties": event.properties,
                    "visitor_id": event.visitor.visitor_id,
                    "session_id": event.session.session_id,
                    "device_type": event.visitor.device_type,
                    "country": event.visitor.country,
                    "referrer": event.session.referrer,
                    "utm_source": event.session.utm_source,
                    "utm_campaign": event.session.utm_campaign,
                }
                for event in queryset[:limit]
            ]
        })


class OverviewView(APIView):
    """GET /api/overview/?site_id=&date_from=&date_to=

    Métricas resumen del rango y del período anterior equivalente, en 2 queries
    (agregación condicional sobre ambos períodos a la vez).
    """

    def get(self, request):
        params = request.query_params
        site = get_site(request.user, params.get("site_id"))
        current = resolve_date_range(site, params.get("date_from"), params.get("date_to"))
        previous = current.previous()

        periods = {"current": Q(started_at__gte=current.start), "previous": Q(started_at__lt=current.start)}
        duration = ExpressionWrapper(F("ended_at") - F("started_at"), output_field=DurationField())
        session_aggregates = {}
        for key, in_period in periods.items():
            session_aggregates.update({
                f"{key}_sessions": Count("id", filter=in_period),
                f"{key}_visitors": Count("visitor_id", distinct=True, filter=in_period),
                f"{key}_bounces": Count("id", filter=in_period & Q(is_bounce=True)),
                f"{key}_duration": Avg(duration, filter=in_period),
            })
        sessions = Session.objects.filter(
            site=site, started_at__gte=previous.start, started_at__lt=current.end
        ).aggregate(**session_aggregates)

        pageviews = Event.objects.filter(
            site=site, event_name="page_view", timestamp__gte=previous.start, timestamp__lt=current.end
        ).aggregate(
            current=Count("id", filter=Q(timestamp__gte=current.start)),
            previous=Count("id", filter=Q(timestamp__lt=current.start)),
        )

        def values(key):
            session_count = sessions[f"{key}_sessions"]
            avg_duration = sessions[f"{key}_duration"]
            return {
                "unique_visitors": sessions[f"{key}_visitors"],
                "sessions": session_count,
                "pageviews": pageviews[key],
                "bounce_rate": percent(sessions[f"{key}_bounces"], session_count),
                "avg_session_duration_seconds": round(avg_duration.total_seconds(), 1) if avg_duration else 0.0,
            }

        now, before = values("current"), values("previous")
        return Response({
            "date_from": current.date_from.isoformat(),
            "date_to": current.date_to.isoformat(),
            "previous_date_from": previous.date_from.isoformat(),
            "previous_date_to": previous.date_to.isoformat(),
            "timezone": site.timezone,
            "metrics": {
                name: {"value": now[name], "previous": before[name], "change_percent": change_percent(now[name], before[name])}
                for name in now
            },
        })


def _site_and_range(request, min_role=Role.VIEWER):
    params = request.query_params
    site = get_site(request.user, params.get("site_id"), min_role)
    return site, resolve_date_range(site, params.get("date_from"), params.get("date_to"))


class AcquisitionReportView(APIView):
    """GET /api/reports/acquisition/?site_id=&date_from=&date_to= — canales, fuentes, campañas, páginas de entrada."""

    def get(self, request):
        site, date_range = _site_and_range(request)
        return Response(reports.acquisition(site, date_range))


class BehaviorReportView(APIView):
    """GET /api/reports/behavior/?site_id=&page= — páginas, scroll, tiempo, clicks, descargas, formularios."""

    def get(self, request):
        site, date_range = _site_and_range(request)
        page = request.query_params.get("page") or None
        return Response(reports.behavior(site, date_range, page))


class AudienceReportView(APIView):
    """GET /api/reports/audience/?site_id= — dispositivos, países, nuevos y recurrentes, horarios."""

    def get(self, request):
        site, date_range = _site_and_range(request)
        return Response(reports.audience(site, date_range))


class InsightsView(APIView):
    """GET /api/insights/?site_id= — mejoras sugeridas para el período."""

    def get(self, request):
        site, date_range = _site_and_range(request)
        return Response({
            "date_from": date_range.date_from.isoformat(),
            "date_to": date_range.date_to.isoformat(),
            "insights": insights.site_insights(site, date_range),
        })


class GoalViewSet(SiteScopedViewSet):
    """/api/goals/?site_id= — objetivos de conversión. Estadísticas en /api/goals/stats/."""

    model = Goal
    serializer_class = GoalSerializer

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Conversiones (visitantes únicos), tasa sobre los visitantes del período, variación y serie diaria."""
        site, current = _site_and_range(request)
        previous = current.previous()
        visitors = Session.objects.filter(
            site=site, started_at__gte=current.start, started_at__lt=current.end
        ).values("visitor_id").distinct().count()
        days = [current.date_from + timedelta(days=i) for i in range(current.days)]
        result = []
        for goal in Goal.objects.filter(site=site):
            queryset = insights.goal_queryset(goal, current)
            conversions = queryset.values("visitor_id").distinct().count()
            before = insights.goal_conversions(goal, previous)
            daily = dict(
                queryset.annotate(day=TruncDate("timestamp", tzinfo=current.tz)).values("day")
                .annotate(n=Count("visitor_id", distinct=True)).values_list("day", "n")
            )
            by_channel = {}
            for row in (
                queryset.values("session__referrer", "session__utm_source", "session__utm_medium")
                .annotate(n=Count("visitor_id", distinct=True))
            ):
                key = reports.channel_of(row["session__referrer"], row["session__utm_source"], row["session__utm_medium"])
                by_channel[key] = by_channel.get(key, 0) + row["n"]
            result.append({
                **GoalSerializer(goal).data,
                "conversions": conversions,
                "events": queryset.count(),
                "rate": percent(conversions, visitors),
                "previous": before,
                "change_percent": change_percent(conversions, before),
                "daily": [daily.get(d, 0) for d in days],
                "by_channel": sorted(
                    ({"key": k, "label": reports.CHANNELS[k], "conversions": v} for k, v in by_channel.items()),
                    key=lambda r: -r["conversions"],
                ),
            })
        return Response({"visitors": visitors, "labels": [d.isoformat() for d in days], "goals": result})


class EventDefinitionViewSet(SiteScopedViewSet):
    """/api/event-definitions/?site_id= — nombre y descripción de cada evento. POST hace upsert por nombre."""

    model = EventDefinition
    serializer_class = EventDefinitionSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        definition, _ = EventDefinition.objects.update_or_create(
            site=data["site"], event_name=data["event_name"],
            defaults={k: v for k, v in data.items() if k in ("label", "description", "is_hidden")},
        )
        return Response(EventDefinitionSerializer(definition).data, status=201)


class EventCatalogView(APIView):
    """GET /api/events/catalog/?site_id=&days=30 — todos los eventos con volumen, tendencia y su definición."""

    def get(self, request):
        site = get_site(request.user, request.query_params.get("site_id"))
        days = _int_param(request.query_params, "days", 30, 1, 366)
        tz = ZoneInfo(site.timezone)
        today = timezone.now().astimezone(tz).date()
        first = today - timedelta(days=days - 1)
        start = datetime.combine(first, time.min, tzinfo=tz)
        events = Event.objects.filter(site=site, timestamp__gte=start)
        totals = events.values("event_name").annotate(
            count=Count("id"), visitors=Count("visitor_id", distinct=True), last_seen=Max("timestamp")
        )
        daily = defaultdict(dict)
        for row in events.annotate(day=TruncDate("timestamp", tzinfo=tz)).values("event_name", "day").annotate(n=Count("id")):
            daily[row["event_name"]][row["day"]] = row["n"]
        definitions = {d.event_name: d for d in EventDefinition.objects.filter(site=site)}
        rule_events = {r.event_name: r.name for r in site.tracking_rules.all()}
        names = {row["event_name"] for row in totals} | set(definitions) | set(rule_events)
        by_name = {row["event_name"]: row for row in totals}
        series_days = [first + timedelta(days=i) for i in range(days)]

        def source(name):
            if name in rule_events:
                return "rule"
            return "auto" if name in RESERVED_EVENTS else "custom"

        catalog = []
        for name in names:
            row, definition = by_name.get(name, {}), definitions.get(name)
            catalog.append({
                "event_name": name,
                "label": definition.label if definition else rule_events.get(name, AUTO_EVENT_LABELS.get(name, "")),
                "description": definition.description if definition else "",
                "is_hidden": definition.is_hidden if definition else False,
                "source": source(name),
                "count": row.get("count", 0),
                "visitors": row.get("visitors", 0),
                "last_seen": row.get("last_seen"),
                "daily": [daily[name].get(d, 0) for d in series_days],
            })
        catalog.sort(key=lambda e: (-e["count"], e["event_name"]))
        return Response({"days": days, "events": catalog, "auto_labels": AUTO_EVENTS})


AUTO_EVENT_LABELS = {
    "page_view": "Página vista", "session_start": "Inicio de sesión", "scroll_depth": "Profundidad de scroll",
    "time_on_page": "Tiempo en la página", "bounce": "Rebote", "click": "Click", "rage_click": "Click de frustración",
    "outbound_click": "Click a otro sitio", "file_download": "Descarga de archivo", "form_submit": "Envío de formulario",
    "video_play": "Video iniciado", "video_progress": "Avance de video", "video_complete": "Video completo",
}


class DashboardViewSet(SiteScopedViewSet):
    """/api/dashboards/?site_id= — tableros con widgets de análisis guardados."""

    model = Dashboard
    serializer_class = DashboardSerializer
