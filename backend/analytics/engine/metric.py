"""Un solo número, con comparación opcional contra el período anterior."""

from django.db.models import Q

from . import validation as v
from .aggregation import MEASURES
from .base import Analysis, register


@register
class MetricAnalysis(Analysis):
    analysis_type = "metric"

    @classmethod
    def clean_config(cls, config):
        return {
            "event_name": v.event_name(config),
            "measure": v.choice(config, "measure", tuple(MEASURES), "count"),
            "filters": v.filters(config),
            "compare_to_previous_period": v.boolean(config, "compare_to_previous_period", False),
        }

    def run(self):
        cfg = self.config
        measure = MEASURES[cfg["measure"]]
        current = self.date_range
        result = {"event_name": cfg["event_name"], "measure": cfg["measure"]}

        if not cfg["compare_to_previous_period"]:
            queryset = self.events().filter(event_name=cfg["event_name"]).filter(cfg["filters"])
            result["value"] = queryset.aggregate(value=measure())["value"]
            return result

        previous = current.previous()
        # Una sola query sobre ambos períodos, con agregación condicional.
        values = (
            self.events(previous.start, current.end)
            .filter(event_name=cfg["event_name"])
            .filter(cfg["filters"])
            .aggregate(
                current=measure(filter=Q(timestamp__gte=current.start)),
                previous=measure(filter=Q(timestamp__lt=current.start)),
            )
        )
        change = values["current"] - values["previous"]
        result.update(
            value=values["current"],
            previous_value=values["previous"],
            change=change,
            change_percent=round(change * 100 / values["previous"], 2) if values["previous"] else None,
            previous_date_from=previous.date_from.isoformat(),
            previous_date_to=previous.date_to.isoformat(),
        )
        return result
