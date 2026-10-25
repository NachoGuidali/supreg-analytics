from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ChangePasswordView, ClientViewSet, MembersViewSet, PaymentsViewSet, PlanViewSet

router = DefaultRouter()
router.register("clients", ClientViewSet, basename="client")
router.register(r"clients/(?P<client_pk>[0-9a-f-]+)/members", MembersViewSet, basename="client-member")
router.register(r"clients/(?P<client_pk>[0-9a-f-]+)/payments", PaymentsViewSet, basename="client-payment")
router.register("plans", PlanViewSet, basename="plan")

urlpatterns = [
    path("auth/password/", ChangePasswordView.as_view(), name="auth-password"),
    *router.urls,
]
