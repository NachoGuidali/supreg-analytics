"""Captura configurable, reglas sin código, objetivos, dashboards, catálogo, reportes y mejoras."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Client, Membership, Role
from analytics.insights import site_insights
from analytics.models import Dashboard, SavedAnalysis
from analytics.params import resolve_date_range
from analytics.reports import acquisition, audience, behavior, channel_of
from sites.models import TrackingRule

from .factories import Tracker, at, make_site

User = get_user_model()
TREND = {"analysis_type": "trend", "config": {"event_name": "page_view"}}


class FeatureTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client_obj = Client.objects.create(name="Acme")
        self.site = make_site(name="Acme", domain="acme.com", client=self.client_obj)
        self.other = make_site(name="Otro", domain="otro.com")
        self.editor = self.member("editor", Role.EDITOR)
        self.viewer = self.member("viewer", Role.VIEWER)

    def member(self, username, role):
        user = User.objects.create_user(username, f"{username}@test.com", "clave-larga-123")
        Membership.objects.create(user=user, client=self.client_obj, role=role)
        return user

    def api(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client


class TrackingSettingsTests(FeatureTestCase):
    def url(self):
        return f"/api/sites/{self.site.id}/tracking/"

    def test_defaults_everything_on(self):
        data = self.api(self.viewer).get(self.url()).json()
        self.assertTrue(all(data["auto"].values()))
        self.assertEqual(data["scroll_marks"], [25, 50, 75, 100])
        self.assertIn("click", data["auto_labels"])

    def test_editor_changes_settings_viewer_cannot(self):
        payload = {"auto": {"click": False}, "scroll_marks": [90, 10, 10], "excluded_paths": ["/admin*", " "]}
        self.assertEqual(self.api(self.viewer).patch(self.url(), payload, format="json").status_code, 403)
        data = self.api(self.editor).patch(self.url(), payload, format="json").json()
        self.assertFalse(data["auto"]["click"])
        self.assertTrue(data["auto"]["scroll_depth"], "lo que no se manda queda como estaba")
        self.assertEqual(data["scroll_marks"], [10, 90])
        self.assertEqual(data["excluded_paths"], ["/admin*"])

    def test_invalid_settings(self):
        api = self.api(self.editor)
        for payload in [{"auto": {"inventado": True}}, {"scroll_marks": [0]}, {"scroll_marks": []},
                        {"excluded_paths": ["admin"]}]:
            with self.subTest(payload=payload):
                self.assertEqual(api.patch(self.url(), payload, format="json").status_code, 400)


class TrackingRuleTests(FeatureTestCase):
    def create(self, user=None, **data):
        payload = {"site_id": str(self.site.id), "name": "Regla", "event_name": "mi_evento", **data}
        return self.api(user or self.editor).post("/api/tracking-rules/", payload, format="json")

    def test_valid_rules_per_kind(self):
        for data in [
            {"kind": "click", "selector": "a[href*='wa.me']"},
            {"kind": "pageview", "url_match": "starts_with", "url_value": "/gracias"},
            {"kind": "scroll", "threshold": 60},
            {"kind": "time", "threshold": 30, "url_match": "contains", "url_value": "/blog"},
            {"kind": "form"},
        ]:
            with self.subTest(kind=data["kind"]):
                self.assertEqual(self.create(**data).status_code, 201, self.create(**data).json())

    def test_rule_validation(self):
        cases = [
            ({"kind": "click"}, "selector"),
            ({"kind": "pageview"}, "url_match"),
            ({"kind": "pageview", "url_match": "equals"}, "url_value"),
            ({"kind": "pageview", "url_match": "regex", "url_value": "(["}, "url_value"),
            ({"kind": "scroll", "threshold": 120}, "threshold"),
            ({"kind": "time"}, "threshold"),
            ({"kind": "click", "selector": ".a", "event_name": "page_view"}, "event_name"),
            ({"kind": "click", "selector": ".a", "event_name": "Con Espacios"}, "event_name"),
        ]
        for data, field in cases:
            with self.subTest(data=data):
                response = self.create(**data)
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())

    def test_viewer_cannot_create_and_other_sites_are_isolated(self):
        self.assertEqual(self.create(user=self.viewer, kind="form").status_code, 400)
        foreign = TrackingRule.objects.create(site=self.other, name="x", event_name="x", kind="form")
        api = self.api(self.editor)
        self.assertEqual(api.get("/api/tracking-rules/").json(), [])
        self.assertEqual(api.delete(f"/api/tracking-rules/{foreign.id}/").status_code, 404)
        response = api.post("/api/tracking-rules/", {"site_id": str(self.other.id), "name": "x", "event_name": "x",
                                                     "kind": "form"}, format="json")
        self.assertEqual(response.status_code, 400)


class PublicConfigTests(FeatureTestCase):
    def config(self, key=None):
        return APIClient().get("/api/track/config/", {"key": key or self.site.api_key})

    def test_config_reflects_settings_and_active_rules(self):
        TrackingRule.objects.create(site=self.site, name="WA", event_name="click_wa", kind="click", selector=".wa")
        TrackingRule.objects.create(site=self.site, name="Off", event_name="apagada", kind="form", is_active=False)
        TrackingRule.objects.create(site=self.site, name="Gracias", event_name="gracias", kind="pageview",
                                    url_match="equals", url_value="/gracias")
        data = self.config().json()
        self.assertEqual(data["scroll"], [25, 50, 75, 100])
        self.assertEqual(
            sorted(data["rules"], key=lambda r: r["e"]),
            [{"e": "click_wa", "k": "click", "s": ".wa"}, {"e": "gracias", "k": "pageview", "m": "equals", "v": "/gracias"}],
        )

    def test_changes_invalidate_cache(self):
        self.assertEqual(self.config().json()["rules"], [])
        TrackingRule.objects.create(site=self.site, name="F", event_name="envio", kind="form")
        self.assertEqual(len(self.config().json()["rules"]), 1)
        self.site.tracking = {**self.site.tracking, "auto": {**self.site.tracking["auto"], "click": False}}
        self.site.save()
        self.assertFalse(self.config().json()["auto"]["click"])

    def test_unknown_key_or_suspended_client(self):
        self.assertEqual(self.config("nope").status_code, 404)
        self.client_obj.is_active = False
        self.client_obj.save()
        self.assertEqual(self.config().status_code, 404)


class GoalTests(FeatureTestCase):
    def test_goal_stats(self):
        tracker = Tracker(self.site)
        for visitor in ("a", "b", "c", "d"):
            tracker.event(visitor, "page_view", at(2), utm_source="instagram" if visitor in "ab" else None)
        tracker.event("a", "whatsapp_click", at(2, 13), page="/productos/x")
        tracker.event("a", "whatsapp_click", at(3, 13), page="/productos/x")
        tracker.event("b", "whatsapp_click", at(3, 14), page="/contacto")
        api = self.api(self.editor)
        api.post("/api/goals/", {"site_id": str(self.site.id), "name": "WhatsApp", "event_name": "whatsapp_click"}, format="json")
        api.post("/api/goals/", {"site_id": str(self.site.id), "name": "WA productos", "event_name": "whatsapp_click",
                                 "page_contains": "/productos"}, format="json")
        data = api.get("/api/goals/stats/", {"site_id": str(self.site.id), "date_from": "2026-09-01",
                                             "date_to": "2026-09-07"}).json()
        goals = {g["name"]: g for g in data["goals"]}
        self.assertEqual(data["visitors"], 4)
        self.assertEqual((goals["WhatsApp"]["conversions"], goals["WhatsApp"]["events"], goals["WhatsApp"]["rate"]), (2, 3, 50.0))
        self.assertEqual(goals["WA productos"]["conversions"], 1)
        self.assertEqual(goals["WhatsApp"]["daily"][:3], [0, 1, 2])
        self.assertEqual(goals["WhatsApp"]["by_channel"][0], {"key": "social", "label": "Redes sociales", "conversions": 2})

    def test_viewer_reads_but_cannot_create(self):
        response = self.api(self.viewer).post("/api/goals/", {"site_id": str(self.site.id), "name": "x", "event_name": "x"},
                                              format="json")
        self.assertEqual(response.status_code, 400)


class DashboardTests(FeatureTestCase):
    def setUp(self):
        super().setUp()
        self.analysis = SavedAnalysis.objects.create(site=self.site, name="Visitas", **TREND)
        self.foreign = SavedAnalysis.objects.create(site=self.other, name="Ajeno", **TREND)

    def create(self, layout, user=None):
        return self.api(user or self.editor).post(
            "/api/dashboards/", {"site_id": str(self.site.id), "name": "Principal", "layout": layout}, format="json"
        )

    def test_create_and_expand_analyses(self):
        response = self.create([{"analysis_id": str(self.analysis.id), "width": 8}])
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()["analyses"][0]["name"], "Visitas")

    def test_layout_validation(self):
        for layout in [[{"analysis_id": str(self.foreign.id), "width": 6}], [{"analysis_id": "x"}],
                       [{"analysis_id": str(self.analysis.id), "width": 5}], "no"]:
            with self.subTest(layout=layout):
                self.assertEqual(self.create(layout).status_code, 400)

    def test_deleted_analysis_disappears_from_layout(self):
        dashboard = Dashboard.objects.create(site=self.site, name="D", layout=[{"analysis_id": str(self.analysis.id), "width": 6}])
        self.analysis.delete()
        data = self.api(self.viewer).get(f"/api/dashboards/{dashboard.id}/").json()
        self.assertEqual(data["layout"], [])

    def test_viewer_cannot_edit(self):
        dashboard = Dashboard.objects.create(site=self.site, name="D")
        self.assertEqual(self.api(self.viewer).patch(f"/api/dashboards/{dashboard.id}/", {"name": "x"}, format="json").status_code, 403)
        self.assertEqual(self.create([], user=self.viewer).status_code, 400)


class CatalogTests(FeatureTestCase):
    def test_catalog_merges_observed_rules_and_definitions(self):
        now = timezone.now()
        tracker = Tracker(self.site)
        tracker.event("a", "page_view", now)
        tracker.event("a", "compra", now)
        TrackingRule.objects.create(site=self.site, name="Llegó a gracias", event_name="gracias", kind="pageview",
                                    url_match="equals", url_value="/gracias")
        api = self.api(self.editor)
        api.post("/api/event-definitions/", {"site_id": str(self.site.id), "event_name": "compra", "label": "Compra",
                                             "is_hidden": True}, format="json")
        api.post("/api/event-definitions/", {"site_id": str(self.site.id), "event_name": "compra", "label": "Compra online",
                                             "is_hidden": True}, format="json")  # upsert
        events = {e["event_name"]: e for e in api.get("/api/events/catalog/", {"site_id": str(self.site.id)}).json()["events"]}
        self.assertEqual(events["compra"]["label"], "Compra online")
        self.assertEqual(events["compra"]["source"], "custom")
        self.assertEqual(events["page_view"]["source"], "auto")
        self.assertEqual(events["gracias"]["source"], "rule")
        self.assertEqual(events["gracias"]["count"], 0)
        self.assertEqual(events["compra"]["daily"][-1], 1)
        names = [e["name"] for e in api.get("/api/events/names/", {"site_id": str(self.site.id)}).json()["event_names"]]
        self.assertNotIn("compra", names, "los ocultos no aparecen en los selectores")


class ReportTests(FeatureTestCase):
    def range(self):
        return resolve_date_range(self.site, "2026-09-01", "2026-09-07")

    def test_channel_classification(self):
        cases = [
            ((None, None, None), "direct"), (("google.com", None, None), "organic_search"),
            (("l.instagram.com", None, None), "social"), (("blog.amigo.com", None, None), "referral"),
            ((None, "facebook", "cpc"), "paid"), ((None, "newsletter", "email"), "email"),
            ((None, "instagram", "social"), "social"), ((None, "partner", None), "campaign"),
        ]
        for args, expected in cases:
            self.assertEqual(channel_of(*args), expected, args)

    def test_reports(self):
        tracker = Tracker(self.site)
        tracker.event("a", "page_view", at(1, 10), page="/", referrer="google.com", landing_page="/", is_bounce=True)
        tracker.event("b", "page_view", at(2, 10), page="/precios", landing_page="/precios")
        tracker.event("b", "scroll_depth", at(2, 10, 1), page="/precios", properties={"depth_percent": 25})
        tracker.event("b", "scroll_depth", at(2, 10, 2), page="/precios", properties={"depth_percent": 50})
        tracker.event("b", "time_on_page", at(2, 10, 3), page="/precios", properties={"seconds": 45})
        tracker.event("b", "time_on_page", at(2, 10, 4), page="/precios", properties={"seconds": "no-num"})
        tracker.event("b", "click", at(2, 10, 3), page="/precios", properties={"text": "Comprar", "element": "button.cta"})
        tracker.event("b", "file_download", at(2, 10, 4), page="/precios", properties={"file_url": "/lista.pdf"})
        tracker.event("b", "compra", at(2, 10, 5), page="/precios")

        acq = acquisition(self.site, self.range())
        self.assertEqual({c["key"]: c["sessions"] for c in acq["channels"]}, {"organic_search": 1, "direct": 1})
        self.assertEqual(acq["trend"]["labels"][0], "2026-09-01")

        beh = behavior(self.site, self.range())
        self.assertEqual(beh["page_views"], 2)
        self.assertEqual([s["percent"] for s in beh["scroll"]], [50.0, 50.0, 0.0, 0.0])
        precios = next(p for p in beh["pages"] if p["page"] == "/precios")
        self.assertEqual((precios["avg_time_seconds"], precios["scroll_50_rate"]), (45.0, 100.0))
        self.assertEqual(beh["clicks"][0]["text"], "Comprar")
        self.assertEqual(beh["downloads"][0]["file_url"], "/lista.pdf")
        self.assertEqual([e["event_name"] for e in beh["custom_events"]], ["compra"])
        self.assertEqual(behavior(self.site, self.range(), page="/")["page_views"], 1)

        aud = audience(self.site, self.range())
        self.assertEqual(aud["total_sessions"], 2)
        self.assertEqual(aud["new_visitors"], 2)
        self.assertEqual(aud["heatmap"][0][10], 0)  # 2026-09-01 es martes
        self.assertEqual(aud["heatmap"][1][10], 1)

    def test_report_endpoints_respect_access(self):
        for name in ("acquisition", "behavior", "audience"):
            self.assertEqual(self.api(self.viewer).get(f"/api/reports/{name}/", {"site_id": str(self.site.id)}).status_code, 200)
            self.assertEqual(self.api(self.viewer).get(f"/api/reports/{name}/", {"site_id": str(self.other.id)}).status_code, 404)


class InsightTests(FeatureTestCase):
    def test_no_data(self):
        found = site_insights(self.site, resolve_date_range(self.site, None, None))
        self.assertEqual([i["key"] for i in found], ["no_data"])

    def test_traffic_growth_and_goal_tip(self):
        tracker = Tracker(self.site)
        now = timezone.now()
        for i in range(20):
            tracker.event(f"old{i}", "page_view", now - timedelta(days=40))
        for i in range(40):
            tracker.event(f"new{i}", "page_view", now - timedelta(hours=1 + i))
        found = {i["key"]: i for i in site_insights(self.site, resolve_date_range(self.site, None, None))}
        self.assertEqual(found["traffic_change"]["kind"], "positive")
        self.assertIn("no_goals", found)

    def test_stale_data(self):
        Tracker(self.site).event("a", "page_view", timezone.now() - timedelta(days=3))
        found = site_insights(self.site, resolve_date_range(self.site, None, None))
        self.assertEqual(found[0]["key"], "stale")


class SetupTests(FeatureTestCase):
    def test_setup_progress(self):
        api = self.api(self.viewer)
        data = api.get(f"/api/sites/{self.site.id}/setup/").json()
        self.assertEqual((data["health"], data["done"]), ("waiting", 2))  # sitio creado + equipo de 2
        Tracker(self.site).event("a", "page_view", timezone.now())
        data = api.get(f"/api/sites/{self.site.id}/setup/").json()
        self.assertEqual(data["health"], "ok")
        self.assertTrue(next(s for s in data["steps"] if s["key"] == "snippet")["done"])
