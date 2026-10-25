"""Planes, vencimientos, pagos, límites y bloqueo opcional por falta de pago."""

from datetime import date, timedelta
from unittest import mock

from django.test import override_settings
from rest_framework.test import APIClient

from accounts import billing
from accounts.models import Plan
from analytics.tests.factories import make_site

from .test_tenancy import TenancyTestCase

TODAY = date(2026, 10, 25)
BLOCK = {"warn_days": 7, "grace_days": 5, "auto_block": True}
WARN_ONLY = {"warn_days": 7, "grace_days": 5, "auto_block": False}


@mock.patch("accounts.billing.today", lambda: TODAY)
class BillingTests(TenancyTestCase):
    def setUp(self):
        super().setUp()
        self.basic = Plan.objects.create(name="Básico", price=15000, max_sites=1)
        self.yearly = Plan.objects.create(name="Anual", price=150000, period=Plan.Period.YEARLY)

    def set_paid_until(self, days_from_today, plan=None):
        self.acme.paid_until = TODAY + timedelta(days=days_from_today)
        self.acme.plan = plan or self.basic
        self.acme.save()

    def test_add_months_clamps_to_month_end(self):
        self.assertEqual(billing.add_months(date(2026, 1, 31), 1), date(2026, 2, 28))
        self.assertEqual(billing.add_months(date(2026, 11, 30), 3), date(2027, 2, 28))
        self.assertEqual(billing.add_months(date(2026, 10, 25), 12), date(2027, 10, 25))

    @override_settings(BILLING=BLOCK)
    def test_status(self):
        cases = [(None, "none"), (30, "ok"), (7, "expiring"), (0, "expiring"), (-3, "overdue"), (-6, "blocked")]
        for days, expected in cases:
            with self.subTest(days=days):
                self.acme.paid_until = None if days is None else TODAY + timedelta(days=days)
                self.assertEqual(billing.status(self.acme)["status"], expected)

    @override_settings(BILLING=WARN_ONLY)
    def test_without_auto_block_overdue_clients_keep_access(self):
        self.set_paid_until(-60)
        self.assertEqual(billing.status(self.acme)["status"], "overdue")
        self.assertEqual(self.api(self.owner).get("/api/sites/").status_code, 200)

    @override_settings(BILLING=BLOCK)
    def test_auto_block_after_grace_and_unblock_on_payment(self):
        self.set_paid_until(-6)
        login = APIClient().post("/api/auth/login/", {"username": "owner", "password": "clave-larga-123"})
        self.assertEqual(login.status_code, 403)
        self.assertIn("vencida", login.json()["detail"])
        response = APIClient().post(
            "/api/track/", {"api_key": self.acme_site.api_key, "event_name": "page_view", "visitor_id": "v", "session_id": "s"},
            format="json", HTTP_ORIGIN="https://acme.com",
        )
        self.assertEqual(response.status_code, 401)
        # Pago: vencimiento desde hoy (el anterior ya había pasado) y vuelve a entrar.
        self.api(self.admin).post(f"/api/clients/{self.acme.id}/payments/", {"amount": "15000", "paid_at": "2026-10-25"})
        self.acme.refresh_from_db()
        self.assertEqual(self.acme.paid_until, date(2026, 11, 25))
        self.assertEqual(self.api(self.owner).get("/api/sites/").status_code, 200)

    @override_settings(BILLING=BLOCK)
    def test_within_grace_still_has_access(self):
        self.set_paid_until(-5)
        self.assertEqual(self.api(self.owner).get("/api/sites/").status_code, 200)

    def test_payment_extends_from_current_due_date_by_plan_period(self):
        self.set_paid_until(10, plan=self.yearly)
        response = self.api(self.admin).post(f"/api/clients/{self.acme.id}/payments/",
                                             {"amount": "150000", "paid_at": "2026-10-25", "method": "mercadopago"})
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()["covers_until"], "2027-11-04")
        self.assertEqual(response.json()["plan_name"], "Anual")
        # extend_periods=0 sólo anota el pago.
        self.api(self.admin).post(f"/api/clients/{self.acme.id}/payments/", {"amount": "1", "paid_at": "2026-10-25", "extend_periods": 0})
        self.acme.refresh_from_db()
        self.assertEqual(self.acme.paid_until, date(2027, 11, 4))
        self.assertEqual(len(self.api(self.admin).get(f"/api/clients/{self.acme.id}/payments/").json()), 2)

    def test_only_platform_manages_plans_payments_and_due_dates(self):
        api = self.api(self.owner)
        self.assertEqual(api.get("/api/plans/").status_code, 403)
        self.assertEqual(api.post(f"/api/clients/{self.acme.id}/payments/", {"amount": "1", "paid_at": "2026-10-25"}).status_code, 403)
        api.patch(f"/api/clients/{self.acme.id}/", {"paid_until": "2030-01-01", "plan_id": self.yearly.id}, format="json")
        self.acme.refresh_from_db()
        self.assertEqual((self.acme.paid_until, self.acme.plan), (None, None))

    def test_platform_assigns_plan_on_create_and_edit(self):
        api = self.api(self.admin)
        response = api.post("/api/clients/", {"name": "Initech", "plan_id": self.basic.id, "paid_until": "2026-11-25"}, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual((response.json()["plan"]["name"], response.json()["billing"]["status"]), ("Básico", "ok"))
        detail = api.get(f"/api/clients/{self.acme.id}/").json()
        self.assertEqual(detail["usage"], {"sites": 1, "events_month": 0})

    def test_plan_site_limit_for_owners(self):
        self.set_paid_until(30)  # Básico: 1 sitio, Acme ya tiene uno
        response = self.api(self.owner).post("/api/sites/", {"name": "Otra", "domain": "otra.com"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("incluye 1 sitio", response.json()["detail"][0])
        response = self.api(self.admin).post("/api/sites/", {"client_id": str(self.acme.id), "name": "Otra", "domain": "otra.com"}, format="json")
        self.assertEqual(response.status_code, 201)

    def test_plan_in_use_cannot_be_deleted(self):
        self.set_paid_until(30)
        api = self.api(self.admin)
        self.assertEqual(api.delete(f"/api/plans/{self.basic.id}/").status_code, 400)
        self.assertEqual(api.delete(f"/api/plans/{self.yearly.id}/").status_code, 204)
        self.assertEqual(api.get("/api/plans/").json()[0]["client_count"], 1)

    @override_settings(BILLING=WARN_ONLY, SALES={"url": "", "whatsapp": "5491100000000", "message": "", "product_url": ""})
    def test_me_shows_billing_only_to_owners(self):
        self.set_paid_until(3)
        owner = self.api(self.owner).get("/api/auth/me/").json()["memberships"][0]["billing"]
        self.assertEqual((owner["status"], owner["days_left"], owner["plan_name"]), ("expiring", 3, "Básico"))
        self.assertIn("renovar", owner["renew_url"])
        self.assertNotIn("billing", self.api(self.viewer).get("/api/auth/me/").json()["memberships"][0])

    def test_currency_validation(self):
        response = self.api(self.admin).post("/api/plans/", {"name": "X", "price": "10", "currency": "pesos"})
        self.assertEqual(response.status_code, 400)
        response = self.api(self.admin).post("/api/plans/", {"name": "Pro", "price": "30", "currency": "usd", "max_sites": 5})
        self.assertEqual((response.status_code, response.json()["currency"]), (201, "USD"))


class DefaultSiteFactoryStillWorks(TenancyTestCase):
    def test_make_site_without_plan(self):
        self.assertIsNone(make_site(domain="libre.com").client.plan)
