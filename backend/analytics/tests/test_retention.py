from datetime import datetime

from django.test import TestCase

from analytics.engine import ConfigError, run_analysis

from .factories import UTC, Tracker, at, make_site


def cell(count, pct):
    return {"count": count, "percent": pct}


class RetentionTests(TestCase):
    def setUp(self):
        self.site = make_site()
        self.t = Tracker(self.site)

    def run_retention(self, date_from="2026-09-01", date_to="2026-09-03", now=None, **config):
        config = {"start_event": "page_view", "return_event": "page_view", "period": "day",
                  "periods_count": 3, **config}
        return run_analysis(self.site, "retention", config, date_from, date_to, now=now or at(30))["data"]

    def by_cohort(self, data):
        return {c["cohort"]: c for c in data["cohorts"]}

    def test_daily_cohorts(self):
        self.t.event("v1", "page_view", at(1))
        self.t.event("v1", "page_view", at(2))
        self.t.event("v1", "page_view", at(4))
        self.t.event("v2", "page_view", at(1))
        self.t.event("v2", "page_view", at(3))
        self.t.event("v3", "page_view", at(2))
        self.t.event("v5", "page_view", at(1, 10))
        self.t.event("v5", "page_view", at(1, 20))  # mismo día: no es retorno
        self.t.event("v5", "page_view", at(5))  # offset 4: fuera de periods_count

        data = self.run_retention()
        cohorts = self.by_cohort(data)

        self.assertEqual(list(cohorts), ["2026-09-01", "2026-09-02", "2026-09-03"])
        self.assertEqual(cohorts["2026-09-01"]["size"], 3)
        self.assertEqual(
            cohorts["2026-09-01"]["values"],
            [cell(3, 100.0), cell(1, 33.33), cell(1, 33.33), cell(1, 33.33)],
        )
        self.assertEqual(cohorts["2026-09-02"]["values"], [cell(1, 100.0), cell(0, 0.0), cell(0, 0.0), cell(0, 0.0)])
        self.assertEqual(cohorts["2026-09-03"], {"cohort": "2026-09-03", "size": 0, "values": [None] * 4})
        # Promedio ponderado: offset 1 = (1 + 0) / (3 + 1).
        self.assertEqual(data["average"], [100.0, 25.0, 25.0, 25.0])

    def test_cohort_uses_first_start_event_ever(self):
        self.t.event("old", "page_view", at(30, month=8))
        self.t.event("old", "page_view", at(1))
        self.t.event("old", "page_view", at(2))
        self.t.event("new", "page_view", at(1))

        cohorts = self.by_cohort(self.run_retention())

        self.assertEqual(cohorts["2026-09-01"]["size"], 1)
        self.assertEqual(cohorts["2026-09-01"]["values"][1], cell(0, 0.0))

    def test_future_periods_are_null(self):
        self.t.event("v1", "page_view", at(1))
        self.t.event("v1", "page_view", at(2))
        self.t.event("v2", "page_view", at(2))

        data = self.run_retention(now=at(3, 8))
        cohorts = self.by_cohort(data)

        # Hoy es 3/09: la columna de hoy se muestra (parcial), la de mañana no.
        self.assertEqual(cohorts["2026-09-01"]["values"], [cell(1, 100.0), cell(1, 100.0), cell(0, 0.0), None])
        self.assertEqual(cohorts["2026-09-02"]["values"], [cell(1, 100.0), cell(0, 0.0), None, None])
        self.assertEqual(data["average"], [100.0, 50.0, 0.0, None])

    def test_periods_use_site_timezone(self):
        # 01:00 UTC del 2 = 22:00 del 1 local -> cohorte 1/09; vuelve el 2 local -> offset 1.
        self.t.event("v1", "page_view", datetime(2026, 9, 2, 1, 0, tzinfo=UTC))
        self.t.event("v1", "page_view", at(2, 10))

        cohorts = self.by_cohort(self.run_retention())

        self.assertEqual(cohorts["2026-09-01"]["size"], 1)
        self.assertEqual(cohorts["2026-09-01"]["values"][1], cell(1, 100.0))

    def test_different_start_and_return_events(self):
        self.t.event("v1", "signup", at(1, 9))
        self.t.event("v1", "purchase", at(1, 15))  # mismo período
        self.t.event("v1", "purchase", at(3))
        self.t.event("v2", "signup", at(1))
        self.t.event("v2", "page_view", at(2))  # no es el return_event
        self.t.event("v3", "purchase", at(1))  # nunca hizo signup
        self.t.event("v3", "purchase", at(2))

        cohorts = self.by_cohort(self.run_retention(start_event="signup", return_event="purchase"))

        self.assertEqual(cohorts["2026-09-01"]["size"], 2)
        self.assertEqual(cohorts["2026-09-01"]["values"][1:], [cell(0, 0.0), cell(1, 50.0), cell(0, 0.0)])

    def test_weekly_cohorts(self):
        self.t.event("v1", "page_view", at(1))  # semana del lunes 31/08
        self.t.event("v1", "page_view", at(8))  # semana siguiente
        self.t.event("v2", "page_view", at(7))  # lunes 7/09: cohorte siguiente
        self.t.event("v2", "page_view", at(13))  # domingo, misma semana: no cuenta
        # Primera visita el lunes 31/08: misma semana que la cohorte, pero antes de date_from.
        self.t.event("v3", "page_view", at(31, month=8))
        self.t.event("v3", "page_view", at(8))

        data = self.run_retention(date_from="2026-09-01", date_to="2026-09-07", period="week", periods_count=2)
        cohorts = self.by_cohort(data)

        self.assertEqual(list(cohorts), ["2026-08-31", "2026-09-07"])
        self.assertEqual(cohorts["2026-08-31"]["values"], [cell(1, 100.0), cell(1, 100.0), cell(0, 0.0)])
        self.assertEqual(cohorts["2026-09-07"]["values"], [cell(1, 100.0), cell(0, 0.0), cell(0, 0.0)])

    def test_filters_apply_to_start_and_return(self):
        self.t.event("v1", "page_view", at(1), session="s1", utm_source="instagram")
        self.t.event("v1", "page_view", at(2), session="s2", utm_source="google")
        self.t.event("v2", "page_view", at(1), session="s3", utm_source="google")

        cohorts = self.by_cohort(self.run_retention(
            filters=[{"property": "utm_source", "operator": "equals", "value": "instagram"}]
        ))

        self.assertEqual(cohorts["2026-09-01"]["size"], 1)
        self.assertEqual(cohorts["2026-09-01"]["values"][1], cell(0, 0.0))

    def test_invalid_config(self):
        invalid = [
            {"start_event": ""},
            {"period": "month"},
            {"periods_count": 0},
            {"periods_count": 91},
        ]
        for config in invalid:
            with self.subTest(config=config), self.assertRaises(ConfigError):
                self.run_retention(**config)
