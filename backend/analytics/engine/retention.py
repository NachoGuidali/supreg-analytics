"""Retención por cohortes.

Semántica:
- La cohorte de un visitante es el período (día/semana local) de su PRIMER
  start_event histórico. Si ese primer evento cae fuera del rango, el visitante no
  entra en ninguna cohorte (no es "nuevo" en el rango).
- El período 0 es siempre el 100% de la cohorte.
- El período k (k >= 1) cuenta a los visitantes de la cohorte que hicieron
  return_event en el período cohorte + k. Volver en el mismo período no cuenta.
- Los períodos que todavía no empezaron (según `now`) valen null, no 0%.
"""

from datetime import timedelta

from django.db import connection
from django.db.models import Min

from tracking.models import Event

from . import validation as v
from .aggregation import percent
from .base import Analysis, register
from .dates import add_periods, period_starts, truncate_date

PERIOD_DAYS = {"day": 1, "week": 7}


@register
class RetentionAnalysis(Analysis):
    analysis_type = "retention"

    @classmethod
    def clean_config(cls, config):
        return {
            "start_event": v.event_name(config, "start_event"),
            "return_event": v.event_name(config, "return_event"),
            "period": v.choice(config, "period", tuple(PERIOD_DAYS), "day"),
            "periods_count": v.integer(config, "periods_count", 7, 1, 90),
            "filters": v.filters(config),
        }

    def _counts(self):
        cfg = self.config
        period, count = cfg["period"], cfg["periods_count"]
        period_days = PERIOD_DAYS[period]
        tz_name = str(self.tz)

        starts_sql, starts_params = (
            # Sin límite inferior: importa el primer start_event de toda la historia.
            Event.objects.filter(site=self.site, event_name=cfg["start_event"], timestamp__lt=self.date_range.end)
            .filter(cfg["filters"])
            .values("visitor_id")
            .annotate(first_ts=Min("timestamp"))
            .filter(first_ts__gte=self.date_range.start)
            .order_by()
            .query.sql_with_params()
        )
        return_end = self.date_range.end + timedelta(days=period_days * (count + 1))
        returns_sql, returns_params = (
            self.events(end=return_end)
            .filter(event_name=cfg["return_event"])
            .filter(cfg["filters"])
            .values("visitor_id", "timestamp")
            .order_by()
            .query.sql_with_params()
        )

        sql = f"""
            WITH starts AS ({starts_sql}),
            cohort AS (
                SELECT visitor_id, date_trunc(%s, first_ts AT TIME ZONE %s)::date AS cohort_date
                FROM starts
            ),
            returns AS (
                SELECT DISTINCT r.visitor_id, date_trunc(%s, r."timestamp" AT TIME ZONE %s)::date AS return_date
                FROM ({returns_sql}) r
                WHERE r.visitor_id IN (SELECT visitor_id FROM cohort)
            )
            SELECT cohort_date, 0 AS period_offset, COUNT(*) FROM cohort GROUP BY cohort_date
            UNION ALL
            SELECT c.cohort_date, (r.return_date - c.cohort_date) / %s AS period_offset, COUNT(*)
            FROM cohort c
            JOIN returns r ON r.visitor_id = c.visitor_id
            WHERE r.return_date > c.cohort_date
              AND r.return_date <= c.cohort_date + %s
            GROUP BY 1, 2
        """
        params = [
            *starts_params,
            period, tz_name,
            period, tz_name, *returns_params,
            period_days, period_days * count,
        ]
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return {(cohort_date, offset): visitors for cohort_date, offset, visitors in cursor.fetchall()}

    def run(self):
        cfg = self.config
        period, count = cfg["period"], cfg["periods_count"]
        counts = self._counts()
        current_period = truncate_date(self.now.astimezone(self.tz).date(), period)

        cohorts = []
        totals = [[0, 0] for _ in range(count + 1)]  # [retenidos, tamaño] por offset
        for cohort_date in period_starts(self.date_range.date_from, self.date_range.date_to, period):
            size = counts.get((cohort_date, 0), 0)
            values = []
            for offset in range(count + 1):
                if size == 0 or add_periods(cohort_date, period, offset) > current_period:
                    values.append(None)
                    continue
                retained = size if offset == 0 else counts.get((cohort_date, offset), 0)
                values.append({"count": retained, "percent": percent(retained, size)})
                totals[offset][0] += retained
                totals[offset][1] += size
            cohorts.append({"cohort": cohort_date.isoformat(), "size": size, "values": values})

        return {
            "start_event": cfg["start_event"],
            "return_event": cfg["return_event"],
            "period": period,
            "periods_count": count,
            "cohorts": cohorts,
            # Promedio ponderado por tamaño de cohorte, sólo sobre celdas ya transcurridas.
            "average": [percent(retained, size) if size else None for retained, size in totals],
        }
