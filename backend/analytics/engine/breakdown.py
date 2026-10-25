"""Ranking de un evento agrupado por un campo."""

from . import validation as v
from .aggregation import MEASURES, format_value, percent, top_values
from .base import Analysis, register


@register
class BreakdownAnalysis(Analysis):
    analysis_type = "breakdown"

    @classmethod
    def clean_config(cls, config):
        return {
            "event_name": v.event_name(config),
            "breakdown_by": v.field(config, "breakdown_by"),
            "measure": v.choice(config, "measure", tuple(MEASURES), "count"),
            "limit": v.integer(config, "limit", 10, 1, 100),
            "filters": v.filters(config),
        }

    def run(self):
        cfg = self.config
        queryset = self.events().filter(event_name=cfg["event_name"]).filter(cfg["filters"])
        measure = MEASURES[cfg["measure"]]
        top = top_values(queryset, cfg["breakdown_by"], measure, cfg["limit"])
        total = queryset.aggregate(value=measure())["value"]

        # Con medidas únicas un visitante puede estar en varios grupos, así que
        # "otros" (total - suma) sólo tiene sentido para count.
        other = None
        if cfg["measure"] == "count":
            other = total - sum(value for _, value in top)

        return {
            "event_name": cfg["event_name"],
            "breakdown_by": cfg["breakdown_by"].name,
            "measure": cfg["measure"],
            "total": total,
            "rows": [
                {"value": format_value(raw), "measure": value, "percent": percent(value, total)}
                for raw, value in top
            ],
            "other": other,
        }
