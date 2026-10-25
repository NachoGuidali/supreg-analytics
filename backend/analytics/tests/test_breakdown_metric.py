from django.test import TestCase

from analytics.engine import ConfigError, run_analysis

from .factories import Tracker, at, make_site


class BreakdownTests(TestCase):
    def setUp(self):
        self.site = make_site()
        t = Tracker(self.site)
        clicks = [("v1", "header"), ("v1", "header"), ("v2", "header"), ("v2", "footer"), ("v3", "body"), ("v3", None)]
        for visitor, location in clicks:
            t.event(visitor, "whatsapp_click", at(2), properties={"location": location} if location else {})
        t.event("v4", "page_view", at(2), properties={"location": "header"})

    def run_breakdown(self, **config):
        config = {"event_name": "whatsapp_click", "breakdown_by": "properties.location", **config}
        return run_analysis(self.site, "breakdown", config, "2026-09-01", "2026-09-07")["data"]

    def test_ranking_with_percent_and_other(self):
        data = self.run_breakdown(limit=2)

        self.assertEqual(data["total"], 6)
        self.assertEqual(data["rows"], [
            {"value": "header", "measure": 3, "percent": 50.0},
            {"value": "body", "measure": 1, "percent": 16.67},
        ])
        self.assertEqual(data["other"], 2)

    def test_missing_value_is_grouped_as_none(self):
        data = self.run_breakdown()

        self.assertIn({"value": "(none)", "measure": 1, "percent": 16.67}, data["rows"])
        self.assertEqual(data["other"], 0)

    def test_unique_visitors_has_no_other(self):
        data = self.run_breakdown(measure="unique_visitors", limit=1)

        self.assertEqual(data["rows"], [{"value": "header", "measure": 2, "percent": 66.67}])
        self.assertEqual(data["total"], 3)
        self.assertIsNone(data["other"])

    def test_requires_breakdown_by(self):
        with self.assertRaises(ConfigError):
            run_analysis(self.site, "breakdown", {"event_name": "whatsapp_click"}, "2026-09-01", "2026-09-07")


class MetricTests(TestCase):
    def setUp(self):
        self.site = make_site()
        self.t = Tracker(self.site)

    def run_metric(self, **config):
        config = {"event_name": "whatsapp_click", "measure": "unique_visitors", **config}
        return run_analysis(self.site, "metric", config, "2026-09-08", "2026-09-14")["data"]

    def test_value_without_comparison(self):
        self.t.event("v1", "whatsapp_click", at(8))
        self.t.event("v1", "whatsapp_click", at(9))

        data = self.run_metric()

        self.assertEqual(data["value"], 1)
        self.assertNotIn("previous_value", data)

    def test_compares_against_previous_period_of_same_length(self):
        for visitor in ("v1", "v2", "v3"):
            self.t.event(visitor, "whatsapp_click", at(8, 0, 0))  # primer instante del período
        self.t.event("v1", "whatsapp_click", at(7, 23, 59))  # último minuto del período anterior
        self.t.event("v4", "whatsapp_click", at(1, 0, 0))  # primer instante del período anterior
        self.t.event("v5", "whatsapp_click", at(31, 23, 59, month=8))  # fuera de ambos

        data = self.run_metric(compare_to_previous_period=True)

        self.assertEqual(data["value"], 3)
        self.assertEqual(data["previous_value"], 2)
        self.assertEqual(data["change"], 1)
        self.assertEqual(data["change_percent"], 50.0)
        self.assertEqual((data["previous_date_from"], data["previous_date_to"]), ("2026-09-01", "2026-09-07"))

    def test_change_percent_is_null_when_previous_is_zero(self):
        self.t.event("v1", "whatsapp_click", at(10))

        data = self.run_metric(compare_to_previous_period=True, measure="count")

        self.assertEqual((data["value"], data["previous_value"], data["change_percent"]), (1, 0, None))

    def test_filters(self):
        self.t.event("v1", "whatsapp_click", at(10), device_type="mobile")
        self.t.event("v2", "whatsapp_click", at(10), device_type="desktop")

        data = self.run_metric(filters=[{"property": "device_type", "operator": "equals", "value": "mobile"}])

        self.assertEqual(data["value"], 1)
