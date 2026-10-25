from datetime import datetime

from django.test import TestCase

from analytics.engine import ConfigError, run_analysis

from .factories import UTC, Tracker, at, make_site


class TrendTests(TestCase):
    def setUp(self):
        self.site = make_site()
        self.t = Tracker(self.site)

    def run_trend(self, config, date_from="2026-09-01", date_to="2026-09-04"):
        return run_analysis(self.site, "trend", config, date_from, date_to)["data"]

    def test_daily_count_fills_empty_days_with_zero(self):
        self.t.event("v1", "page_view", at(1, 10))
        self.t.event("v2", "page_view", at(1, 15))
        self.t.event("v1", "page_view", at(3, 9))
        self.t.event("v1", "otro_evento", at(2, 9))

        data = self.run_trend({"event_name": "page_view"})

        self.assertEqual(data["labels"], ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"])
        self.assertEqual(len(data["series"]), 1)
        self.assertEqual(data["series"][0]["data"], [2, 0, 1, 0])
        self.assertEqual(data["series"][0]["total"], 3)

    def test_days_are_cut_in_site_timezone(self):
        # 02:00 UTC del 2 = 23:00 del 1 en Buenos Aires.
        self.t.event("v1", "page_view", datetime(2026, 9, 2, 2, 0, tzinfo=UTC))
        self.t.event("v1", "page_view", at(2, 0, 30))
        # 23:59 del 31/08 local: fuera del rango aunque en UTC ya sea 1/09.
        self.t.event("v1", "page_view", at(31, 23, 59, month=8))
        # 23:59 del 2/09 local: último minuto dentro del rango.
        self.t.event("v1", "page_view", at(2, 23, 59))

        data = self.run_trend({"event_name": "page_view"}, "2026-09-01", "2026-09-02")

        self.assertEqual(data["series"][0]["data"], [1, 2])

    def test_measures(self):
        self.t.event("v1", "page_view", at(1, 10), session="s1")
        self.t.event("v1", "page_view", at(1, 11), session="s1")
        self.t.event("v1", "page_view", at(1, 18), session="s2")
        self.t.event("v2", "page_view", at(1, 12), session="s3")

        expected = {"count": 4, "unique_visitors": 2, "unique_sessions": 3}
        for measure, value in expected.items():
            with self.subTest(measure=measure):
                data = self.run_trend({"event_name": "page_view", "measure": measure}, "2026-09-01", "2026-09-01")
                self.assertEqual(data["series"][0]["data"], [value])
                self.assertEqual(data["series"][0]["total"], value)

    def test_unique_total_is_not_the_sum_of_days(self):
        self.t.event("v1", "page_view", at(1))
        self.t.event("v1", "page_view", at(2))

        data = self.run_trend({"event_name": "page_view", "measure": "unique_visitors"}, "2026-09-01", "2026-09-02")

        self.assertEqual(data["series"][0]["data"], [1, 1])
        self.assertEqual(data["series"][0]["total"], 1)

    def test_weekly_buckets_start_on_monday_local_time(self):
        self.t.event("v1", "page_view", at(1))  # martes
        self.t.event("v1", "page_view", at(6, 23, 30))  # domingo 23:30 local = lunes en UTC
        self.t.event("v1", "page_view", at(7, 0, 5))  # lunes
        self.t.event("v1", "page_view", at(14))  # lunes

        data = self.run_trend({"event_name": "page_view", "group_by": "week"}, "2026-09-01", "2026-09-14")

        self.assertEqual(data["labels"], ["2026-08-31", "2026-09-07", "2026-09-14"])
        self.assertEqual(data["series"][0]["data"], [2, 1, 1])

    def test_monthly_buckets(self):
        self.t.event("v1", "page_view", at(20, month=8))
        self.t.event("v1", "page_view", at(5))
        self.t.event("v1", "page_view", at(10, month=8))  # antes del rango

        data = self.run_trend({"event_name": "page_view", "group_by": "month"}, "2026-08-15", "2026-09-10")

        self.assertEqual(data["labels"], ["2026-08-01", "2026-09-01"])
        self.assertEqual(data["series"][0]["data"], [1, 1])

    def test_breakdown_returns_one_series_per_value_ordered_by_total(self):
        self.t.event("v1", "whatsapp_click", at(1), properties={"location": "header"})
        self.t.event("v1", "whatsapp_click", at(2), properties={"location": "header"})
        self.t.event("v2", "whatsapp_click", at(2), properties={"location": "header"})
        self.t.event("v2", "whatsapp_click", at(1), properties={"location": "footer"})
        self.t.event("v3", "whatsapp_click", at(3), properties={})

        data = self.run_trend({"event_name": "whatsapp_click", "breakdown_by": "properties.location"})

        self.assertEqual(data["breakdown_by"], "properties.location")
        self.assertEqual([s["key"] for s in data["series"]], ["header", "footer", "(none)"])
        by_key = {s["key"]: s for s in data["series"]}
        self.assertEqual(by_key["header"]["data"], [1, 2, 0, 0])
        self.assertEqual(by_key["header"]["total"], 3)
        self.assertEqual(by_key["footer"]["data"], [1, 0, 0, 0])
        self.assertEqual(by_key["(none)"]["data"], [0, 0, 1, 0])

    def test_breakdown_limit_and_unique_measure(self):
        for visitor, location in [("v1", "header"), ("v1", "header"), ("v2", "header"), ("v3", "footer"), ("v4", "body")]:
            self.t.event(visitor, "whatsapp_click", at(1), properties={"location": location})

        data = self.run_trend({
            "event_name": "whatsapp_click", "breakdown_by": "properties.location",
            "breakdown_limit": 1, "measure": "unique_visitors",
        })

        self.assertEqual(len(data["series"]), 1)
        self.assertEqual(data["series"][0]["key"], "header")
        self.assertEqual(data["series"][0]["data"][0], 2)

    def test_breakdown_by_session_field_with_filters(self):
        self.t.event("v1", "signup", at(1), session="s1", utm_source="instagram", properties={"plan": "pro"})
        self.t.event("v2", "signup", at(1), session="s2", utm_source="google", properties={"plan": "pro"})
        self.t.event("v3", "signup", at(1), session="s3", utm_source="google", properties={"plan": "free"})

        data = self.run_trend({
            "event_name": "signup",
            "breakdown_by": "utm_source",
            "filters": [{"property": "properties.plan", "operator": "equals", "value": "pro"}],
        })

        self.assertEqual({s["key"]: s["total"] for s in data["series"]}, {"google": 1, "instagram": 1})

    def test_invalid_config(self):
        invalid = [
            {},
            {"event_name": "page_view", "group_by": "hour"},
            {"event_name": "page_view", "measure": "sum"},
            {"event_name": "page_view", "breakdown_by": "nope"},
            {"event_name": "page_view", "breakdown_limit": 0},
        ]
        for config in invalid:
            with self.subTest(config=config), self.assertRaises(ConfigError):
                self.run_trend(config)
