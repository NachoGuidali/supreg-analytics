import uuid
from datetime import datetime, time, timedelta, timezone as dt_timezone

from django.contrib.auth import update_session_auth_hash
from django.db import transaction
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from tracking.models import Event, Session

from .access import clients_for, has_role, is_platform_admin, role_for_client, roles_by_client
from . import billing
from .permissions import IsPlatformAdmin
from .models import Client, Membership, Payment, Plan, Role
from .serializers import (
    AddMemberSerializer, ChangePasswordSerializer, ClientSerializer, MembershipSerializer, PaymentSerializer,
    PlanSerializer, ResetPasswordSerializer, find_user_by_email,
    resolve_user,
)


def _client_or_none(user, client_id):
    try:
        client_uuid = uuid.UUID(str(client_id))
    except ValueError:
        return None
    return clients_for(user).filter(pk=client_uuid).first()


class ClientViewSet(viewsets.ModelViewSet):
    """/api/clients/ — clientes visibles para el usuario.

    Alta y baja: sólo la plataforma. Renombrar: la plataforma o un dueño.
    Equipo: /api/clients/{id}/members/ (ver MembersViewSet).
    """

    serializer_class = ClientSerializer

    def get_queryset(self):
        min_role = Role.OWNER if self.action in ("update", "partial_update") else Role.VIEWER
        return clients_for(self.request.user, min_role).select_related("plan").annotate(
            site_count=Count("sites", distinct=True), member_count=Count("memberships", distinct=True)
        )

    def get_serializer_context(self):
        user = self.request.user
        return {
            **super().get_serializer_context(),
            "is_platform_admin": is_platform_admin(user),
            "roles": roles_by_client(user),
        }

    def create(self, request, *args, **kwargs):
        if not is_platform_admin(request.user):
            raise PermissionDenied("Sólo la plataforma puede dar de alta clientes.")
        return super().create(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not is_platform_admin(request.user):
            raise PermissionDenied("Sólo la plataforma puede borrar clientes.")
        client = self.get_object()
        if client.sites.exists():
            raise ValidationError(
                {"detail": "El cliente tiene sitios. Borralos primero desde el admin (se pierden sus eventos) "
                           "o suspendé el cliente."}
            )
        client.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def retrieve(self, request, *args, **kwargs):
        """El detalle suma el uso del mes, para compararlo con los límites del plan."""
        client = self.get_object()
        data = self.get_serializer(client).data
        month_start = timezone.localdate().replace(day=1)
        data["usage"] = {
            "sites": client.sites.count(),
            "events_month": Event.objects.filter(
                site__client=client,
                timestamp__gte=datetime.combine(month_start, time.min, tzinfo=timezone.get_current_timezone()),
            ).count(),
        }
        return Response(data)

    @action(detail=False, methods=["get"])
    def activity(self, request):
        """GET /api/clients/activity/?days=14 — sesiones por día de cada cliente visible.

        Para las mini-tendencias del panel de clientes. Los días se cortan en UTC: cada
        sitio puede tener otra zona horaria y acá sólo importa la forma de la curva.
        """
        try:
            days = min(max(int(request.query_params.get("days", 14)), 1), 90)
        except ValueError:
            raise ValidationError({"days": "Debe ser un entero."}) from None
        today = timezone.now().date()
        first_day = today - timedelta(days=days - 1)
        rows = (
            Session.objects.filter(
                site__client__in=clients_for(request.user),
                started_at__gte=datetime.combine(first_day, time.min, tzinfo=dt_timezone.utc),
            )
            .annotate(day=TruncDate("started_at", tzinfo=dt_timezone.utc))
            .values("site__client_id", "day")
            .annotate(count=Count("id"))
        )
        series = {}
        for row in rows:
            counts = series.setdefault(str(row["site__client_id"]), [0] * days)
            counts[(row["day"] - first_day).days] = row["count"]
        return Response({
            "date_from": first_day.isoformat(),
            "date_to": today.isoformat(),
            "series": series,
        })

    def get_object(self):
        # Un PATCH de alguien que ve el cliente pero no es dueño es 403, no 404.
        if self.action in ("update", "partial_update"):
            client = _client_or_none(self.request.user, self.kwargs["pk"])
            if client is not None and not has_role(role_for_client(self.request.user, client.id), Role.OWNER):
                raise PermissionDenied("Sólo un dueño puede modificar el cliente.")
        return super().get_object()


class MembersViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin,
                     viewsets.GenericViewSet):
    """/api/clients/{client_id}/members/ — equipo del cliente.

    Listar: cualquier miembro. Agregar, cambiar rol y quitar: dueños (y la plataforma).
    Agregar un email que ya tiene usuario lo suma al cliente; si no, crea el usuario con
    la contraseña indicada. Nunca queda un cliente sin dueño.
    """

    serializer_class = MembershipSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self.client = _client_or_none(request.user, kwargs["client_pk"])
        if self.client is None:
            raise NotFound("Cliente inexistente.")
        if self.action != "list" and not has_role(role_for_client(request.user, self.client.id), Role.OWNER):
            raise PermissionDenied("Sólo un dueño puede gestionar el equipo.")

    def get_queryset(self):
        return Membership.objects.filter(client=self.client).select_related("user")

    def create(self, request, *args, **kwargs):
        serializer = AddMemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        existing = find_user_by_email(serializer.validated_data["email"])
        if existing and Membership.objects.filter(client=self.client, user=existing).exists():
            raise ValidationError({"email": "Esa persona ya es parte del equipo."})
        with transaction.atomic():
            user = existing or resolve_user(serializer.validated_data)
            membership = Membership.objects.create(client=self.client, user=user, role=serializer.validated_data["role"])
        # user_created: el frontend arma el mensaje con la contraseña sólo si el usuario es nuevo.
        data = {**MembershipSerializer(membership).data, "user_created": existing is None}
        return Response(data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        membership = serializer.instance
        new_role = serializer.validated_data.get("role", membership.role)
        if membership.role == Role.OWNER and new_role != Role.OWNER:
            self._ensure_other_owner(membership)
        serializer.save()

    def perform_destroy(self, membership):
        if membership.role == Role.OWNER:
            self._ensure_other_owner(membership)
        membership.delete()

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, client_pk=None, pk=None):
        """POST .../members/{id}/reset-password/ {password} — contraseña nueva para alguien que la olvidó.

        La plataforma puede siempre. Un dueño sólo si esa persona pertenece únicamente a su
        cliente: si no, podría tomar la cuenta de alguien que trabaja también para otros.
        """
        membership = self.get_object()
        user = membership.user
        if not is_platform_admin(request.user):
            if user.is_superuser or user.memberships.exclude(client=self.client).exists():
                raise PermissionDenied("Esta persona también trabaja con otros clientes: pedile el cambio a la plataforma.")
        serializer = ResetPasswordSerializer(data=request.data, context={"user": user})
        serializer.is_valid(raise_exception=True)
        user.set_password(serializer.validated_data["password"])
        user.save(update_fields=["password"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _ensure_other_owner(self, membership):
        if not self.client.memberships.filter(role=Role.OWNER).exclude(pk=membership.pk).exists():
            raise ValidationError({"detail": "El cliente tiene que tener al menos un dueño."})


class ChangePasswordView(APIView):
    """POST /api/auth/password/ {current_password, new_password}"""

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"user": request.user})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        update_session_auth_hash(request, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PlanViewSet(viewsets.ModelViewSet):
    """/api/plans/ — planes comerciales. Sólo la plataforma."""

    serializer_class = PlanSerializer
    permission_classes = [IsPlatformAdmin]

    def get_queryset(self):
        return Plan.objects.annotate(client_count=Count("clients"))

    def destroy(self, request, *args, **kwargs):
        plan = self.get_object()
        if plan.clients.exists():
            raise ValidationError({"detail": "Hay clientes con este plan. Cambiales el plan o desactivalo en vez de borrarlo."})
        plan.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PaymentsViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin,
                      viewsets.GenericViewSet):
    """/api/clients/{client_id}/payments/ — pagos del cliente. Sólo la plataforma.

    Registrar un pago corre el vencimiento `extend_periods` períodos del plan (desde el
    vencimiento actual si sigue vigente, si no desde hoy). Borrar un pago no toca la fecha.
    """

    serializer_class = PaymentSerializer
    permission_classes = [IsPlatformAdmin]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self.client = _client_or_none(request.user, kwargs["client_pk"])
        if self.client is None:
            raise NotFound("Cliente inexistente.")

    def get_queryset(self):
        return Payment.objects.filter(client=self.client).select_related("plan", "created_by")

    def perform_create(self, serializer):
        periods = serializer.validated_data.pop("extend_periods", 1)
        client = self.client
        covers_until = client.paid_until
        if periods:
            months = (client.plan.months if client.plan else 1) * periods
            covers_until = billing.next_paid_until(client, months)
            client.paid_until = covers_until
            client.save(update_fields=["paid_until"])
        serializer.save(client=client, plan=client.plan, covers_until=covers_until, created_by=self.request.user)
