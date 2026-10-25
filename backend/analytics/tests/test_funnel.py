from django.test import TestCase

from analytics.engine import ConfigError, run_analysis

from .factories import Tracker, at, make_site

STEPS = [{"event_name": "page_view"}, {"event_name": "signup"}, {"event_name": "purchase"}]


class FunnelTests(TestCase):
    def setUp(self):
        self.site = make_site()
        self.t = Tracker(self.site)

    def run_funnel(self, steps=STEPS, date_from="2026-09-01", date_to="2026-09-07", **config):
        config = {"steps": steps, "conversion_window_hours": 24, **config}
        return run_analysis(self.site, "funnel", config, date_from, date_to)["data"]

    def counts(self, **kwargs):
        return [step["count"] for step in self.run_funnel(**kwargs)["steps"]]

    def test_counts_and_percentages_with_natural_drop_off(self):
        for visitor in ("v1", "v2", "v3", "v4"):
            self.t.event(visitor, "page_view", at(1, 10))
        for visitor in ("v1", "v2"):
            self.t.event(visitor, "signup", at(1, 11))
        self.t.event("v1", "purchase", at(1, 12))
        self.t.event("v5", "signup", at(1, 11))  # nunca hizo el paso 1

        data = self.run_funnel()

        steps = data["steps"]
        self.assertEqual([s["count"] for s in steps], [4, 2, 1])
        self.assertEqual([s["conversion_from_previous"] for s in steps], [100.0, 50.0, 50.0])
        self.assertEqual([s["conversion_from_start"] for s in steps], [100.0, 50.0, 25.0])
        self.assertEqual([s["drop_off"] for s in steps], [0, 2, 1])
        self.assertEqual(data["overall_conversion"], 25.0)
        self.assertEqual([s["event_name"] for s in steps], ["page_view", "signup", "purchase"])

    def test_steps_must_happen_in_order(self):
        self.t.event("v1", "signup", at(1, 9))
        self.t.event("v1", "page_view", at(1, 10))
        self.t.event("v1", "purchase", at(1, 11))

        self.assertEqual(self.counts(), [1, 0, 0])

    def test_skipping_a_step_does_not_count_later_steps(self):
        self.t.event("v1", "page_view", at(1, 10))
        self.t.event("v1", "purchase", at(1, 11))

        self.assertEqual(self.counts(), [1, 0, 0])

    def test_window_boundary_is_inclusive(self):
        self.t.event("v1", "page_view", at(1, 10))
        self.t.event("v1", "signup", at(2, 10))  # exactamente 24h
        self.t.event("v2", "page_view", at(1, 10))
        self.t.event("v2", "signup", at(2, 10, 1))  # 24h y 1 minuto

        self.assertEqual(self.counts(), [2, 1, 0])

    def test_window_is_measured_from_first_step_not_previous(self):
        self.t.event("v1", "page_view", at(1, 10))
        self.t.event("v1", "signup", at(1, 20))
        self.t.event("v1", "purchase", at(2, 11))  # 10h después de signup, 25h después de page_view

        self.assertEqual(self.counts(), [1, 1, 0])

    def test_later_attempt_can_convert(self):
        self.t.event("v1", "page_view", at(1, 10))  # intento que expira
        self.t.event("v1", "page_view", at(3, 10))
        self.t.event("v1", "signup", at(3, 11))

        self.assertEqual(self.counts(), [1, 1, 0])

    def test_later_start_reaching_same_event_keeps_more_window(self):
        # Desde page_view 10:00 el purchase queda fuera de ventana; desde page_view 20:00 entra.
        # Ambos intentos llegan al mismo signup: tiene que sobrevivir el que empezó más tarde.
        self.t.event("v1", "page_view", at(1, 10))
        self.t.event("v1", "page_view", at(1, 20))
        self.t.event("v1", "signup", at(1, 21))
        self.t.event("v1", "purchase", at(2, 15))

        self.assertEqual(self.counts(), [1, 1, 1])

    def test_counts_unique_visitors_not_events(self):
        for hour in (10, 11, 12):
            self.t.event("v1", "page_view", at(1, hour))
            self.t.event("v1", "signup", at(1, hour, 30))

        self.assertEqual(self.counts(), [1, 1, 0])

    def test_repeated_event_needs_two_distinct_occurrences(self):
        steps = [{"event_name": "page_view"}, {"event_name": "page_view"}]
        self.t.event("v1", "page_view", at(1, 10))
        self.t.event("v2", "page_view", at(1, 10))
        self.t.event("v2", "page_view", at(1, 11))

        self.assertEqual(self.counts(steps=steps), [2, 1])

    def test_same_timestamp_uses_arrival_order(self):
        self.t.event("v1", "page_view", at(1, 10))
        self.t.event("v1", "signup", at(1, 10))
        self.t.event("v2", "signup", at(1, 10))
        self.t.event("v2", "page_view", at(1, 10))

        self.assertEqual(self.counts(), [2, 1, 0])

    def test_step_filters(self):
        steps = [
            {"event_name": "page_view"},
            {"event_name": "scroll_depth", "filters": [
                {"property": "properties.depth_percent", "operator": "gte", "value": 50}]},
        ]
        self.t.event("v1", "page_view", at(1, 10))
        self.t.event("v1", "scroll_depth", at(1, 11), properties={"depth_percent": 25})
        self.t.event("v2", "page_view", at(1, 10))
        self.t.event("v2", "scroll_depth", at(1, 11), properties={"depth_percent": 75})

        self.assertEqual(self.counts(steps=steps), [2, 1])

    def test_global_filters_apply_to_every_step(self):
        for visitor, source in (("v1", "instagram"), ("v2", "google")):
            self.t.event(visitor, "page_view", at(1, 10), utm_source=source)
            self.t.event(visitor, "signup", at(1, 11))
            self.t.event(visitor, "purchase", at(1, 12))

        counts = self.counts(filters=[{"property": "utm_source", "operator": "equals", "value": "instagram"}])

        self.assertEqual(counts, [1, 1, 1])

    def test_first_step_must_be_in_range_later_steps_may_exceed_it(self):
        self.t.event("v1", "page_view", at(1, 23))
        self.t.event("v1", "signup", at(2, 1))  # después de date_to, dentro de ventana
        self.t.event("v2", "page_view", at(31, 23, month=8))  # antes de date_from
        self.t.event("v2", "signup", at(1, 1))

        self.assertEqual(self.counts(date_from="2026-09-01", date_to="2026-09-01"), [1, 1, 0])

    def test_other_sites_are_ignored(self):
        other = Tracker(make_site(name="Otro", domain="otro.com"))
        other.event("v1", "page_view", at(1, 10))
        other.event("v1", "signup", at(1, 11))

        self.assertEqual(self.counts(), [0, 0, 0])

    def test_empty_funnel_has_zero_percentages(self):
        data = self.run_funnel()

        self.assertEqual([s["conversion_from_previous"] for s in data["steps"]], [0.0, 0.0, 0.0])
        self.assertEqual(data["overall_conversion"], 0.0)

    def test_invalid_config(self):
        invalid = [
            {"steps": [{"event_name": "page_view"}]},
            {"steps": "page_view"},
            {"steps": [{"event_name": "page_view"}, {}]},
            {"steps": STEPS, "conversion_window_hours": 0},
            {"steps": STEPS, "conversion_window_hours": "24"},
            {"steps": [{"event_name": "a"}, {"event_name": "b", "filters": [{"property": "x"}]}]},
        ]
        for config in invalid:
            with self.subTest(config=config), self.assertRaises(ConfigError):
                run_analysis(self.site, "funnel", config, "2026-09-01", "2026-09-07")
