"""Ingesta: validación del origen de los envíos."""

from django.test import TestCase
from rest_framework.test import APIClient

from analytics.tests.factories import make_site
from tracking.models import Event

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1"


class OriginTests(TestCase):
    def setUp(self):
        self.site = make_site(domain="tienda.com")

    def send(self, **headers):
        body = {"api_key": self.site.api_key, "events": [
            {"event_name": "outbound_click", "visitor_id": "v", "session_id": "s", "page": "/", "properties": {}},
        ]}
        return APIClient().post("/api/track/batch/", body, format="json", HTTP_USER_AGENT=UA, **headers)

    def test_origin_of_the_site_or_subdomain(self):
        self.assertEqual(self.send(HTTP_ORIGIN="https://www.tienda.com").status_code, 204)

    def test_without_origin_the_referer_is_used(self):
        # Safari en iOS no manda Origin en envíos hechos al salir de la página.
        self.assertEqual(self.send(HTTP_REFERER="https://tienda.com/productos?x=1").status_code, 204)
        self.assertEqual(self.send(HTTP_ORIGIN="null", HTTP_REFERER="https://www.tienda.com/").status_code, 204)
        self.assertEqual(Event.objects.count(), 2)

    def test_foreign_or_missing_origin_is_rejected(self):
        self.assertEqual(self.send(HTTP_ORIGIN="https://otro.com").status_code, 403)
        self.assertEqual(self.send(HTTP_REFERER="https://tienda.com.otro.com/").status_code, 403)
        self.assertEqual(self.send().status_code, 403)
        self.assertEqual(Event.objects.count(), 0)
