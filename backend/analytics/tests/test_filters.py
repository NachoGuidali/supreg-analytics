from django.test import TestCase

from analytics.engine import ConfigError
from analytics.engine.filters import build_filters
from tracking.models import Event

from .factories import Tracker, at, make_site


def f(prop, operator, value=None):
    return {"property": prop, "operator": operator, "value": value}


class FilterTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = make_site()
        other_site = make_site(name="Otro", domain="otro.com")
        t = Tracker(cls.site)
        t.event(
            "v1", "a", at(1), page="/productos/zapatos", device_type="mobile",
            utm_source="instagram", is_bounce=True,
            properties={"location": "header", "depth_percent": 50, "nested": {"level": 2},
                        "flag": True, "contains": "x"},
        )
        t.event(
            "v2", "b", at(1), page="/home", utm_source="google",
            properties={"location": "Footer", "depth_percent": "75", "empty": "", "nullish": None},
        )
        t.event("v3", "c", at(1), page="/contacto", properties={"depth_percent": "n/a"})
        # Mismo nombre de propiedad en otro sitio: nunca debe aparecer.
        Tracker(other_site).event("x1", "z", at(1), properties={"location": "header"})

    def match(self, *filters):
        q = build_filters(list(filters))
        return set(Event.objects.filter(site=self.site).filter(q).values_list("event_name", flat=True))

    # --- equals / not_equals ---

    def test_empty_filters_match_everything(self):
        self.assertEqual(self.match(), {"a", "b", "c"})
        self.assertEqual(set(Event.objects.filter(site=self.site).filter(build_filters(None)).values_list("event_name", flat=True)), {"a", "b", "c"})

    def test_equals_event_column(self):
        self.assertEqual(self.match(f("event_name", "equals", "a")), {"a"})
        self.assertEqual(self.match(f("page", "equals", "/home")), {"b"})

    def test_equals_session_column(self):
        self.assertEqual(self.match(f("utm_source", "equals", "instagram")), {"a"})

    def test_equals_visitor_column(self):
        self.assertEqual(self.match(f("device_type", "equals", "mobile")), {"a"})

    def test_equals_boolean_session_column_accepts_text(self):
        self.assertEqual(self.match(f("is_bounce", "equals", "true")), {"a"})
        self.assertEqual(self.match(f("is_bounce", "equals", False)), {"b", "c"})

    def test_equals_property_string_is_case_sensitive(self):
        self.assertEqual(self.match(f("properties.location", "equals", "header")), {"a"})
        self.assertEqual(self.match(f("properties.location", "equals", "footer")), set())

    def test_equals_property_tolerates_number_vs_text(self):
        # 50 está guardado como número; "75" como texto.
        self.assertEqual(self.match(f("properties.depth_percent", "equals", "50")), {"a"})
        self.assertEqual(self.match(f("properties.depth_percent", "equals", 75)), {"b"})

    def test_equals_property_boolean_from_text(self):
        self.assertEqual(self.match(f("properties.flag", "equals", "true")), {"a"})

    def test_equals_nested_property(self):
        self.assertEqual(self.match(f("properties.nested.level", "equals", 2)), {"a"})

    def test_property_named_like_a_django_lookup(self):
        self.assertEqual(self.match(f("properties.contains", "equals", "x")), {"a"})
        self.assertEqual(self.match(f("properties.contains", "is_set")), {"a"})

    def test_not_equals_property_includes_missing_key(self):
        self.assertEqual(self.match(f("properties.location", "not_equals", "header")), {"b", "c"})

    def test_not_equals_column_includes_null(self):
        self.assertEqual(self.match(f("utm_source", "not_equals", "instagram")), {"b", "c"})

    # --- contains ---

    def test_contains_is_case_insensitive(self):
        self.assertEqual(self.match(f("page", "contains", "PRODUCTOS")), {"a"})
        self.assertEqual(self.match(f("properties.location", "contains", "foot")), {"b"})

    def test_contains_escapes_like_wildcards(self):
        self.assertEqual(self.match(f("page", "contains", "%")), set())
        self.assertEqual(self.match(f("page", "contains", "_")), set())

    def test_not_contains_includes_missing(self):
        self.assertEqual(self.match(f("properties.location", "not_contains", "foot")), {"a", "c"})
        self.assertEqual(self.match(f("utm_source", "not_contains", "insta")), {"b", "c"})

    # --- numéricos ---

    def test_numeric_comparisons_on_numbers_and_numeric_text(self):
        self.assertEqual(self.match(f("properties.depth_percent", "gte", 50)), {"a", "b"})
        self.assertEqual(self.match(f("properties.depth_percent", "gt", 50)), {"b"})
        self.assertEqual(self.match(f("properties.depth_percent", "lt", 75)), {"a"})
        self.assertEqual(self.match(f("properties.depth_percent", "lte", "75")), {"a", "b"})

    def test_numeric_comparison_ignores_non_numeric_values(self):
        # "n/a" no rompe la query, simplemente no matchea.
        self.assertEqual(self.match(f("properties.depth_percent", "gt", -1000)), {"a", "b"})

    # --- is_set / is_not_set ---

    def test_is_set(self):
        self.assertEqual(self.match(f("properties.location", "is_set")), {"a", "b"})
        self.assertEqual(self.match(f("utm_source", "is_set")), {"a", "b"})

    def test_empty_string_and_json_null_are_not_set(self):
        self.assertEqual(self.match(f("properties.empty", "is_set")), set())
        self.assertEqual(self.match(f("properties.nullish", "is_set")), set())
        self.assertEqual(self.match(f("properties.empty", "is_not_set")), {"a", "b", "c"})

    def test_is_not_set(self):
        self.assertEqual(self.match(f("properties.location", "is_not_set")), {"c"})
        self.assertEqual(self.match(f("utm_source", "is_not_set")), {"c"})

    # --- in ---

    def test_in(self):
        self.assertEqual(self.match(f("properties.location", "in", ["header", "Footer"])), {"a", "b"})
        self.assertEqual(self.match(f("event_name", "in", ["a", "c"])), {"a", "c"})
        self.assertEqual(self.match(f("properties.depth_percent", "in", ["50", 75])), {"a", "b"})

    # --- combinación ---

    def test_filters_are_combined_with_and(self):
        self.assertEqual(
            self.match(f("utm_source", "equals", "instagram"), f("page", "contains", "zapatos")), {"a"}
        )
        self.assertEqual(
            self.match(f("utm_source", "equals", "google"), f("page", "contains", "zapatos")), set()
        )

    # --- errores ---

    def test_invalid_configs_raise_config_error(self):
        invalid = [
            [f("desconocido", "equals", "x")],
            [f("page", "parecido", "x")],
            [f("properties.con espacio", "equals", "x")],
            [f("properties.", "equals", "x")],
            [f("properties.depth_percent", "gt", "mucho")],
            [f("page", "gt", 3)],
            [f("properties.location", "in", "header")],
            [f("properties.location", "in", [])],
            [f("properties.location", "equals", None)],
            [f("properties.location", "equals", {"a": 1})],
            [f("is_bounce", "contains", "tru")],
            [f("is_bounce", "equals", "quizás")],
            ["no es un objeto"],
        ]
        for filters in invalid:
            with self.subTest(filters=filters), self.assertRaises(ConfigError):
                build_filters(filters)
        with self.assertRaises(ConfigError):
            build_filters({"property": "page"})

    def test_error_message_points_to_the_filter(self):
        with self.assertRaisesMessage(ConfigError, "Filtro 2"):
            build_filters([f("page", "equals", "/"), f("nope", "equals", "x")])
