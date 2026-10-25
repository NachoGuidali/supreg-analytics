"""Evolución de un evento en el tiempo, con breakdown opcional."""

from . import validation as v
from .aggregation import MEASURES, breakdown_in, format_value, top_values
from .base import Analysis, register
from .dates import PERIODS, period_starts, trunc_expression


@register
class TrendAnalysis(Analysis):
    analysis_type = "trend"

    @classmethod
    def clean_config(cls, config):
        return {
            "event_name": v.event_name(config),
            "filters": v.filters(config),
            "group_by": v.choice(config, "group_by", PERIODS, "day"),
            "measure": v.choice(config, "measure", tuple(MEASURES), "count"),
            "breakdown_by": v.optional_field(config, "breakdown_by"),
            "breakdown_limit": v.integer(config, "breakdown_limit", 10, 1, 50),
        }

    def run(self):
        cfg = self.config
        queryset = self.events().filter(event_name=cfg["event_name"]).filter(cfg["filters"])
        periods = period_starts(self.date_range.date_from, self.date_range.date_to, cfg["group_by"])
        period = trunc_expression(cfg["group_by"], self.tz)
        measure = MEASURES[cfg["measure"]]
        field = cfg["breakdown_by"]

        if field is None:
            rows = queryset.annotate(period=period).values("period").annotate(value=measure()).order_by()
            by_period = {row["period"]: row["value"] for row in rows}
            total = queryset.aggregate(value=measure())["value"]
            series = [
                {
                    "key": cfg["event_name"],
                    "label": cfg["event_name"],
                    "data": [by_period.get(p, 0) for p in periods],
                    "total": total,
                }
            ]
        else:
            # 1) los N valores con más peso en todo el rango, 2) su serie temporal.
            top = top_values(queryset, field, measure, cfg["breakdown_limit"])
            rows = (
                queryset.annotate(breakdown=field.group_expression(), period=period)
                .filter(breakdown_in([raw for raw, _ in top]))
                .values("breakdown", "period")
                .annotate(value=measure())
                .order_by()
            )
            grid = {(row["breakdown"], row["period"]): row["value"] for row in rows}
            series = [
                {
                    "key": format_value(raw),
                    "label": format_value(raw),
                    "data": [grid.get((raw, p), 0) for p in periods],
                    "total": total,
                }
                for raw, total in top
            ]

        return {
            "event_name": cfg["event_name"],
            "group_by": cfg["group_by"],
            "measure": cfg["measure"],
            "breakdown_by": field.name if field else None,
            "labels": [p.isoformat() for p in periods],
            "series": series,
        }
