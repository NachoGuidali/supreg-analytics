"""Embudo de conversión por visitante único.

Semántica:
- Un visitante entra al paso 1 con cualquier ocurrencia del evento 1 dentro del rango.
- El paso k+1 tiene que ocurrir DESPUÉS del evento usado para el paso k y dentro de
  `conversion_window_hours` contados desde el paso 1. Puede caer después de
  date_to, siempre que esté dentro de la ventana.
- "Después" es por (timestamp, id): con timestamps iguales manda el orden de llegada,
  y un mismo evento nunca cuenta para dos pasos (importa en page_view -> page_view).
- Si un intento no convierte, se prueban los intentos siguientes: cada visitante
  cuenta hasta el paso más profundo que alcanzó desde cualquiera de sus pasos 1.

Implementación: cada paso es un queryset del ORM (con todos los filtros) compilado a
SQL y usado como CTE. La secuencia se resuelve en Postgres como programación
dinámica, un paso a la vez: para cada evento del paso k+1 se calcula, con un
MAX() OVER acumulado por visitante, el inicio más tardío entre todos los caminos
que llegaron al paso k antes que él (el más tardío es el que deja más ventana).
Si ese inicio está dentro de la ventana, el evento alcanza el paso k+1. Es una
pasada ordenada por paso, sin joins por evento.
"""

from datetime import timedelta

from django.db import connection

from . import validation as v
from .aggregation import percent
from .base import Analysis, register
from .errors import ConfigError

MAX_STEPS = 10


@register
class FunnelAnalysis(Analysis):
    analysis_type = "funnel"

    @classmethod
    def clean_config(cls, config):
        steps = []
        for index, step in enumerate(v.object_list(config, "steps", 2, MAX_STEPS), start=1):
            try:
                steps.append({"event_name": v.event_name(step), "filters": v.filters(step)})
            except ConfigError as exc:
                raise ConfigError(f"Paso {index}: {exc}") from exc
        return {
            "steps": steps,
            "filters": v.filters(config),
            "conversion_window_hours": v.integer(config, "conversion_window_hours", 24, 1, 24 * 90),
        }

    def _step_sql(self, step, end):
        queryset = (
            self.events(end=end)
            .filter(event_name=step["event_name"])
            .filter(self.config["filters"])
            .filter(step["filters"])
            .values("id", "visitor_id", "timestamp")
            .order_by()
        )
        return queryset.query.sql_with_params()

    def _reached_counts(self):
        steps = self.config["steps"]
        window = timedelta(hours=self.config["conversion_window_hours"])
        ctes, params = [], []

        for index, step in enumerate(steps):
            end = self.date_range.end if index == 0 else self.date_range.end + window
            sql, step_params = self._step_sql(step, end)
            ctes.append(f"step_{index} AS ({sql})")
            params.extend(step_params)

        ctes.append(
            'reach_0 AS (SELECT visitor_id, id AS event_id, "timestamp" AS ts, "timestamp" AS start_ts FROM step_0)'
        )
        for index in range(1, len(steps)):
            # Se mezclan los caminos que llegaron al paso anterior (is_next = 0) con los
            # eventos candidatos del paso siguiente (is_next = 1). El frame termina en
            # "1 PRECEDING" y, ante el mismo evento en ambos lados (page_view -> page_view),
            # is_next DESC pone primero al candidato: un evento nunca se usa dos veces.
            ctes.append(
                f"""reach_{index} AS (
                    SELECT visitor_id, event_id, ts, best_start AS start_ts
                    FROM (
                        SELECT merged.*, MAX(merged.start_ts) OVER (
                            PARTITION BY merged.visitor_id
                            ORDER BY merged.ts, merged.event_id, merged.is_next DESC
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ) AS best_start
                        FROM (
                            SELECT visitor_id, event_id, ts, start_ts, 0 AS is_next FROM reach_{index - 1}
                            UNION ALL
                            SELECT visitor_id, id, "timestamp", NULL, 1 FROM step_{index}
                        ) merged
                    ) ranked
                    WHERE is_next = 1 AND best_start IS NOT NULL AND ts <= best_start + %s
                )"""
            )
            params.append(window)

        select = " UNION ALL ".join(
            f"SELECT {index} AS step, COUNT(DISTINCT visitor_id) FROM reach_{index}" for index in range(len(steps))
        )
        with connection.cursor() as cursor:
            cursor.execute(f"WITH {', '.join(ctes)} {select}", params)
            return dict(cursor.fetchall())

    def run(self):
        counts = self._reached_counts()
        steps = self.config["steps"]
        first = counts.get(0, 0)
        result_steps = []
        previous = first
        for index, step in enumerate(steps):
            count = counts.get(index, 0)
            result_steps.append(
                {
                    "index": index,
                    "event_name": step["event_name"],
                    "count": count,
                    "conversion_from_previous": 100.0 if index == 0 and count else percent(count, previous),
                    "conversion_from_start": percent(count, first),
                    "drop_off": previous - count,
                }
            )
            previous = count

        return {
            "conversion_window_hours": self.config["conversion_window_hours"],
            "steps": result_steps,
            "overall_conversion": percent(counts.get(len(steps) - 1, 0), first),
        }
