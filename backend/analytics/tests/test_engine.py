from django.test import TestCase

from analytics.engine import REGISTRY, Analysis, ConfigError, register, run_analysis, validate_config

from .factories import Tracker, at, make_site


class EngineTests(TestCase):
    def setUp(self):
        self.site = make_site()

    def test_all_spec_types_are_registered(self):
        self.assertTrue({"trend", "funnel", "retention", "breakdown", "metric"} <= set(REGISTRY))

    def test_unknown_type(self):
        with self.assertRaisesMessage(ConfigError, "desconocido"):
            run_analysis(self.site, "pie", {}, "2026-09-01", "2026-09-02")

    def test_config_must_be_an_object(self):
        with self.assertRaises(ConfigError):
            run_analysis(self.site, "trend", [], "2026-09-01", "2026-09-02")

    def test_invalid_dates(self):
        config = {"event_name": "page_view"}
        for date_from, date_to in [("2026-09-02", "2026-09-01"), ("ayer", "2026-09-01"), (None, "2026-09-01"),
                                   ("2020-01-01", "2026-09-01")]:
            with self.subTest(date_from=date_from, date_to=date_to), self.assertRaises(ConfigError):
                run_analysis(self.site, "trend", config, date_from, date_to)

    def test_response_envelope(self):
        result = run_analysis(self.site, "metric", {"event_name": "x"}, "2026-09-01", "2026-09-02")

        self.assertEqual(result["analysis_type"], "metric")
        self.assertEqual((result["date_from"], result["date_to"]), ("2026-09-01", "2026-09-02"))
        self.assertEqual(result["timezone"], "America/Argentina/Buenos_Aires")
        self.assertEqual(result["data"]["value"], 0)

    def test_validate_config_does_not_touch_the_database(self):
        with self.assertNumQueries(0):
            validate_config("funnel", {"steps": [{"event_name": "a"}, {"event_name": "b"}]})
        with self.assertRaises(ConfigError):
            validate_config("funnel", {"steps": []})

    def test_new_type_can_be_added_without_touching_existing_ones(self):
        @register
        class EventCountByName(Analysis):
            analysis_type = "test_distinct_names"

            @classmethod
            def clean_config(cls, config):
                return {}

            def run(self):
                return {"names": sorted(set(self.events().values_list("event_name", flat=True)))}

        self.addCleanup(REGISTRY.pop, "test_distinct_names")
        Tracker(self.site).event("v1", "page_view", at(1))

        result = run_analysis(self.site, "test_distinct_names", {}, "2026-09-01", "2026-09-01")

        self.assertEqual(result["data"], {"names": ["page_view"]})

    def test_duplicate_registration_fails(self):
        with self.assertRaises(TypeError):
            @register
            class Duplicate(Analysis):
                analysis_type = "trend"
