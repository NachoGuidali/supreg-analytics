"""Aislamiento entre clientes y permisos por rol en toda la API de consulta."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Client, Membership, Role
from analytics.models import SavedAnalysis
from analytics.tests.factories import Tracker, at, make_site

User = get_user_model()

TREND = {"analysis_type": "trend", "config": {"event_name": "page_view"}}


def make_user(username, *, superuser=False):
    return User.objects.create_user(username, f"{username}@test.com", "clave-larga-123", is_superuser=superuser)


class TenancyTestCase(TestCase):
    def setUp(self):
        self.acme = Client.objects.create(name="Acme")
        self.globex = Client.objects.create(name="Globex")
        self.acme_site = make_site(name="Acme web", domain="acme.com", client=self.acme)
        self.globex_site = make_site(name="Globex web", domain="globex.com", client=self.globex)
        Tracker(self.globex_site).event("v1", "page_view", at(1))
        self.globex_analysis = SavedAnalysis.objects.create(site=self.globex_site, name="Secreto", **TREND)

        self.owner = self.member("owner", Role.OWNER)
        self.editor = self.member("editor", Role.EDITOR)
        self.viewer = self.member("viewer", Role.VIEWER)
        self.admin = make_user("admin", superuser=True)

    def member(self, username, role, client=None):
        user = make_user(username)
        Membership.objects.create(user=user, client=client or self.acme, role=role)
        return user

    def api(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client


class IsolationTests(TenancyTestCase):
    """Un miembro de Acme no puede ver ni tocar nada de Globex."""

    def test_site_list_only_shows_own_client(self):
        response = self.api(self.viewer).get("/api/sites/")
        self.assertEqual([s["id"] for s in response.json()], [str(self.acme_site.id)])
        self.assertEqual(response.json()[0]["role"], Role.VIEWER)

    def test_foreign_site_is_not_found_everywhere(self):
        api = self.api(self.owner)
        site_id = str(self.globex_site.id)
        requests = [
            api.get(f"/api/sites/{site_id}/"),
            api.patch(f"/api/sites/{site_id}/", {"name": "x"}),
            api.post("/api/analysis/run/", {"site_id": site_id, **TREND}, format="json"),
            api.get("/api/events/names/", {"site_id": site_id}),
            api.get("/api/events/properties/", {"site_id": site_id, "event_name": "page_view"}),
            api.get("/api/events/recent/", {"site_id": site_id}),
            api.get("/api/overview/", {"site_id": site_id}),
            api.get("/api/analyses/", {"site_id": site_id}),
        ]
        for response in requests:
            with self.subTest(url=response.request["PATH_INFO"]):
                self.assertEqual(response.status_code, 404)

    def test_foreign_saved_analysis_is_invisible(self):
        api = self.api(self.owner)
        self.assertEqual(api.get("/api/analyses/").json(), [])
        for response in [
            api.get(f"/api/analyses/{self.globex_analysis.id}/"),
            api.get(f"/api/analyses/{self.globex_analysis.id}/run/"),
            api.patch(f"/api/analyses/{self.globex_analysis.id}/", {"name": "x"}, format="json"),
            api.delete(f"/api/analyses/{self.globex_analysis.id}/"),
        ]:
            self.assertEqual(response.status_code, 404)
        self.assertTrue(SavedAnalysis.objects.filter(pk=self.globex_analysis.pk, name="Secreto").exists())

    def test_cannot_save_analysis_in_foreign_site(self):
        response = self.api(self.owner).post(
            "/api/analyses/", {"site_id": str(self.globex_site.id), "name": "x", **TREND}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("site_id", response.json())

    def test_cannot_move_analysis_to_foreign_site(self):
        analysis = SavedAnalysis.objects.create(site=self.acme_site, name="Mío", **TREND)
        response = self.api(self.owner).patch(
            f"/api/analyses/{analysis.id}/", {"site_id": str(self.globex_site.id)}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_create_site_in_foreign_client(self):
        response = self.api(self.owner).post(
            "/api/sites/", {"client_id": str(self.globex.id), "name": "x", "domain": "x.com"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.globex.sites.filter(domain="x.com").exists())

    def test_clients_and_members_of_other_client_are_invisible(self):
        api = self.api(self.owner)
        self.assertEqual([c["id"] for c in api.get("/api/clients/").json()], [str(self.acme.id)])
        self.assertEqual(api.get(f"/api/clients/{self.globex.id}/").status_code, 404)
        self.assertEqual(api.get(f"/api/clients/{self.globex.id}/members/").status_code, 404)
        self.assertEqual(api.get("/api/clients/no-es-uuid/members/").status_code, 404)

    def test_user_in_two_clients_sees_both(self):
        Membership.objects.create(user=self.viewer, client=self.globex, role=Role.EDITOR)
        sites = {s["id"]: s["role"] for s in self.api(self.viewer).get("/api/sites/").json()}
        self.assertEqual(sites, {str(self.acme_site.id): Role.VIEWER, str(self.globex_site.id): Role.EDITOR})


class RoleTests(TenancyTestCase):
    def test_viewer_reads_but_cannot_write(self):
        api = self.api(self.viewer)
        site_id = str(self.acme_site.id)
        self.assertEqual(api.post("/api/analysis/run/", {"site_id": site_id, **TREND}, format="json").status_code, 200)
        self.assertEqual(api.get("/api/overview/", {"site_id": site_id}).status_code, 200)
        analysis = SavedAnalysis.objects.create(site=self.acme_site, name="A", **TREND)
        self.assertEqual(api.get(f"/api/analyses/{analysis.id}/run/").status_code, 200)

        self.assertEqual(
            api.post("/api/analyses/", {"site_id": site_id, "name": "x", **TREND}, format="json").status_code, 400
        )
        self.assertEqual(api.patch(f"/api/analyses/{analysis.id}/", {"name": "x"}, format="json").status_code, 403)
        self.assertEqual(api.delete(f"/api/analyses/{analysis.id}/").status_code, 403)
        self.assertEqual(api.patch(f"/api/sites/{site_id}/", {"name": "x"}, format="json").status_code, 403)

    def test_editor_manages_analyses_but_not_sites(self):
        api = self.api(self.editor)
        site_id = str(self.acme_site.id)
        response = api.post("/api/analyses/", {"site_id": site_id, "name": "x", **TREND}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(api.delete(f"/api/analyses/{response.json()['id']}/").status_code, 204)
        self.assertEqual(api.patch(f"/api/sites/{site_id}/", {"name": "x"}, format="json").status_code, 403)
        self.assertEqual(api.post("/api/sites/", {"name": "x", "domain": "x.com"}, format="json").status_code, 400)
        self.assertEqual(api.post(f"/api/clients/{self.acme.id}/members/", {"email": "a@b.com"}).status_code, 403)

    def test_owner_creates_site_in_their_only_client(self):
        response = self.api(self.owner).post("/api/sites/", {"name": "Tienda", "domain": "tienda.com"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["client_id"], str(self.acme.id))

    def test_owner_of_two_clients_must_choose(self):
        Membership.objects.create(user=self.owner, client=self.globex, role=Role.OWNER)
        api = self.api(self.owner)
        self.assertEqual(api.post("/api/sites/", {"name": "x", "domain": "x.com"}, format="json").status_code, 400)
        response = api.post(
            "/api/sites/", {"client_id": str(self.globex.id), "name": "x", "domain": "x.com"}, format="json"
        )
        self.assertEqual(response.status_code, 201)

    def test_site_cannot_be_moved_to_another_client(self):
        Membership.objects.create(user=self.owner, client=self.globex, role=Role.OWNER)
        self.api(self.owner).patch(
            f"/api/sites/{self.acme_site.id}/", {"client_id": str(self.globex.id)}, format="json"
        )
        self.acme_site.refresh_from_db()
        self.assertEqual(self.acme_site.client, self.acme)


class MembersTests(TenancyTestCase):
    def url(self, membership=None):
        base = f"/api/clients/{self.acme.id}/members/"
        return f"{base}{membership.id}/" if membership else base

    def test_any_member_lists_team(self):
        emails = {m["email"] for m in self.api(self.viewer).get(self.url()).json()}
        self.assertEqual(emails, {"owner@test.com", "editor@test.com", "viewer@test.com"})

    def test_owner_adds_new_user_who_can_log_in(self):
        response = self.api(self.owner).post(
            self.url(), {"email": "Nueva@Acme.com", "password": "otra-clave-larga-1", "role": "editor"}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["role"], "editor")
        self.assertTrue(response.json()["user_created"])
        login = APIClient().post("/api/auth/login/", {"username": "nueva@acme.com", "password": "otra-clave-larga-1"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["memberships"][0]["client_name"], "Acme")

    def test_new_user_requires_valid_password(self):
        api = self.api(self.owner)
        self.assertIn("password", api.post(self.url(), {"email": "x@acme.com"}).json())
        self.assertIn("password", api.post(self.url(), {"email": "x@acme.com", "password": "123"}).json())

    def test_existing_user_is_added_without_password(self):
        outsider = make_user("outsider")
        response = self.api(self.owner).post(self.url(), {"email": "OUTSIDER@test.com", "role": "viewer"})
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()["user_created"])
        self.assertTrue(Membership.objects.filter(user=outsider, client=self.acme).exists())
        self.assertEqual(self.api(self.owner).post(self.url(), {"email": "outsider@test.com"}).status_code, 400)

    def test_owner_changes_role_and_removes_member(self):
        api = self.api(self.owner)
        membership = Membership.objects.get(user=self.viewer)
        self.assertEqual(api.patch(self.url(membership), {"role": "editor"}).json()["role"], "editor")
        self.assertEqual(api.delete(self.url(membership)).status_code, 204)
        self.assertEqual(self.api(self.viewer).get("/api/sites/").status_code, 403)

    def test_last_owner_cannot_leave(self):
        api = self.api(self.owner)
        membership = Membership.objects.get(user=self.owner)
        self.assertEqual(api.patch(self.url(membership), {"role": "viewer"}).status_code, 400)
        self.assertEqual(api.delete(self.url(membership)).status_code, 400)
        Membership.objects.filter(user=self.editor).update(role=Role.OWNER)
        self.assertEqual(api.delete(self.url(membership)).status_code, 204)

    def test_cannot_edit_membership_of_other_client_through_own_url(self):
        foreign = self.member("spy", Role.VIEWER, client=self.globex)
        membership = Membership.objects.get(user=foreign)
        self.assertEqual(self.api(self.owner).delete(self.url(membership)).status_code, 404)


class ClientAdminTests(TenancyTestCase):
    def test_platform_admin_creates_client_with_owner(self):
        response = self.api(self.admin).post("/api/clients/", {
            "name": "Initech", "notes": "Plan anual",
            "owner": {"email": "jefe@initech.com", "password": "clave-larga-456"},
        }, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        client = Client.objects.get(name="Initech")
        self.assertEqual(client.memberships.get().role, Role.OWNER)
        login = APIClient().post("/api/auth/login/", {"username": "jefe@initech.com", "password": "clave-larga-456"})
        self.assertEqual(login.status_code, 200)

    def test_invalid_owner_rolls_back_client(self):
        response = self.api(self.admin).post(
            "/api/clients/", {"name": "Initech", "owner": {"email": "jefe@initech.com"}}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("owner", response.json())
        self.assertFalse(Client.objects.filter(name="Initech").exists())

    def test_platform_admin_sees_everything(self):
        api = self.api(self.admin)
        self.assertEqual(len(api.get("/api/sites/").json()), 2)
        clients = {c["name"]: c for c in api.get("/api/clients/").json()}
        self.assertEqual(clients["Acme"]["member_count"], 3)
        self.assertEqual(clients["Globex"]["site_count"], 1)
        self.assertEqual(api.get("/api/overview/", {"site_id": str(self.globex_site.id)}).status_code, 200)

    def test_client_users_cannot_create_or_delete_clients(self):
        api = self.api(self.owner)
        self.assertEqual(api.post("/api/clients/", {"name": "x"}).status_code, 403)
        self.assertEqual(api.delete(f"/api/clients/{self.acme.id}/").status_code, 403)

    def test_owner_renames_but_cannot_suspend_or_see_notes(self):
        self.acme.notes = "debe dos meses"
        self.acme.save()
        api = self.api(self.owner)
        response = api.patch(f"/api/clients/{self.acme.id}/", {"name": "Acme SA", "is_active": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("notes", response.json())
        self.acme.refresh_from_db()
        self.assertEqual((self.acme.name, self.acme.is_active), ("Acme SA", True))
        self.assertEqual(self.api(self.editor).patch(f"/api/clients/{self.acme.id}/", {"name": "x"}).status_code, 403)

    def test_client_with_sites_cannot_be_deleted(self):
        api = self.api(self.admin)
        self.assertEqual(api.delete(f"/api/clients/{self.acme.id}/").status_code, 400)
        empty = Client.objects.create(name="Vacío")
        self.assertEqual(api.delete(f"/api/clients/{empty.id}/").status_code, 204)


class AccessTests(TenancyTestCase):
    def login(self, username):
        return APIClient().post("/api/auth/login/", {"username": username, "password": "clave-larga-123"})

    def test_user_without_membership_cannot_log_in(self):
        make_user("nadie")
        self.assertEqual(self.login("nadie").status_code, 403)

    def test_login_by_email_or_username(self):
        self.assertEqual(self.login("owner").status_code, 200)
        self.assertEqual(self.login("OWNER@test.com").status_code, 200)

    def test_sales_links_for_visitors(self):
        from django.test import override_settings

        with override_settings(SALES={"url": "", "whatsapp": "5491100000000", "message": "Hola, quiero", "product_url": "https://x.com/analytics"}):
            data = APIClient().get("/api/auth/me/").json()
        self.assertEqual(data["sales"], {"url": "https://wa.me/5491100000000?text=Hola%2C%20quiero", "product_url": "https://x.com/analytics"})
        with override_settings(SALES={"url": "https://pago.test/x", "whatsapp": "5491100000000", "message": "", "product_url": ""}):
            self.assertEqual(APIClient().get("/api/auth/me/").json()["sales"]["url"], "https://pago.test/x")

    def test_me_payload(self):
        api = self.api(self.editor)
        data = api.get("/api/auth/me/").json()
        self.assertFalse(data["is_platform_admin"])
        self.assertEqual(data["memberships"], [{"client_id": str(self.acme.id), "client_name": "Acme", "role": "editor"}])
        self.assertTrue(self.api(self.admin).get("/api/auth/me/").json()["is_platform_admin"])

    def test_suspended_client_loses_access_and_stops_ingesting(self):
        self.acme.is_active = False
        self.acme.save()
        self.assertEqual(self.login("owner").status_code, 403)
        self.assertEqual(self.api(self.owner).get("/api/sites/").status_code, 403)
        self.assertFalse(self.api(self.owner).get("/api/auth/me/").json()["authenticated"])
        # El admin sigue viendo el cliente suspendido.
        self.assertEqual(self.api(self.admin).get(f"/api/sites/{self.acme_site.id}/").status_code, 200)

        response = APIClient().post(
            "/api/track/",
            {"api_key": self.acme_site.api_key, "event_name": "page_view", "visitor_id": "v", "session_id": "s"},
            format="json", HTTP_ORIGIN="https://acme.com",
        )
        self.assertEqual(response.status_code, 401)

    def test_change_password(self):
        api = self.api(self.viewer)
        url = "/api/auth/password/"
        self.assertEqual(api.post(url, {"current_password": "mal", "new_password": "nueva-clave-789"}).status_code, 400)
        self.assertEqual(
            api.post(url, {"current_password": "clave-larga-123", "new_password": "nueva-clave-789"}).status_code, 204
        )
        self.viewer.refresh_from_db()
        self.assertTrue(self.viewer.check_password("nueva-clave-789"))


class ActivityTests(TenancyTestCase):
    def test_activity_only_includes_visible_clients(self):
        from django.utils import timezone

        Tracker(self.acme_site).event("a1", "page_view", timezone.now())
        Tracker(self.globex_site).event("g2", "page_view", timezone.now(), session="g2-hoy")
        mine = self.api(self.owner).get("/api/clients/activity/", {"days": 7}).json()
        self.assertEqual(list(mine["series"]), [str(self.acme.id)])
        self.assertEqual(mine["series"][str(self.acme.id)], [0, 0, 0, 0, 0, 0, 1])
        everything = self.api(self.admin).get("/api/clients/activity/", {"days": 7}).json()
        self.assertEqual(set(everything["series"]), {str(self.acme.id), str(self.globex.id)})


class ResetPasswordTests(TenancyTestCase):
    def url(self, user, client=None):
        membership = Membership.objects.get(user=user, client=client or self.acme)
        return f"/api/clients/{membership.client_id}/members/{membership.id}/reset-password/"

    def test_owner_resets_password_of_own_member(self):
        response = self.api(self.owner).post(self.url(self.viewer), {"password": "otra-clave-larga-9"})
        self.assertEqual(response.status_code, 204)
        self.viewer.refresh_from_db()
        self.assertTrue(self.viewer.check_password("otra-clave-larga-9"))

    def test_owner_cannot_reset_someone_in_other_clients(self):
        Membership.objects.create(user=self.viewer, client=self.globex, role=Role.VIEWER)
        self.assertEqual(self.api(self.owner).post(self.url(self.viewer), {"password": "otra-clave-larga-9"}).status_code, 403)
        self.assertEqual(self.api(self.admin).post(self.url(self.viewer), {"password": "otra-clave-larga-9"}).status_code, 204)

    def test_editor_cannot_reset_and_weak_password_rejected(self):
        self.assertEqual(self.api(self.editor).post(self.url(self.viewer), {"password": "otra-clave-larga-9"}).status_code, 403)
        self.assertEqual(self.api(self.owner).post(self.url(self.viewer), {"password": "123"}).status_code, 400)
