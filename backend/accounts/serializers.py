from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

from . import billing
from .models import Client, Membership, Payment, Plan, Role

User = get_user_model()


def find_user_by_email(email):
    return User.objects.filter(email__iexact=email).first()


def create_user(email, password, first_name=""):
    """Los usuarios de clientes entran con su email: se usa también como username."""
    email = User.objects.normalize_email(email).lower()
    if User.objects.filter(username__iexact=email).exists():
        raise serializers.ValidationError({"email": "Ya existe un usuario con ese nombre."})
    user = User(username=email, email=email, first_name=first_name)
    try:
        validate_password(password, user)
    except Exception as exc:  # django.core.exceptions.ValidationError
        raise serializers.ValidationError({"password": list(exc.messages)}) from exc
    user.set_password(password)
    user.save()
    return user


class NewUserSerializer(serializers.Serializer):
    """Datos para sumar a alguien a un cliente: si el email ya tiene usuario, se reutiliza."""

    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    password = serializers.CharField(required=False, allow_blank=True, write_only=True, trim_whitespace=False)



def resolve_user(data):
    """`data` validado por NewUserSerializer: usuario existente por email, o uno nuevo."""
    user = find_user_by_email(data["email"])
    if user is not None:
        return user
    if not data.get("password"):
        raise serializers.ValidationError({"password": "Es obligatoria para un usuario nuevo."})
    return create_user(data["email"], data["password"], data.get("first_name", ""))


class PlanSerializer(serializers.ModelSerializer):
    client_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Plan
        fields = ["id", "name", "description", "price", "currency", "period", "max_sites", "monthly_events",
                  "is_active", "client_count", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_currency(self, value):
        value = value.strip().upper()
        if len(value) != 3 or not value.isalpha():
            raise serializers.ValidationError("Usá el código de 3 letras: ARS, USD…")
        return value


class ClientSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    site_count = serializers.IntegerField(read_only=True)
    member_count = serializers.IntegerField(read_only=True)
    plan_id = serializers.PrimaryKeyRelatedField(source="plan", queryset=Plan.objects.all(), required=False, allow_null=True)
    plan = serializers.SerializerMethodField()
    billing = serializers.SerializerMethodField()
    # Sólo en el alta: el primer dueño del cliente.
    owner = NewUserSerializer(write_only=True, required=False)

    class Meta:
        model = Client
        fields = ["id", "name", "is_active", "notes", "created_at", "role", "site_count", "member_count",
                  "plan_id", "plan", "paid_until", "billing", "owner"]
        read_only_fields = ["id", "created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Estado, plan, vencimiento y notas internas son cosa de la plataforma: el cliente no los cambia
        # ni ve las notas.
        if not self.context.get("is_platform_admin"):
            for name in ("is_active", "plan_id", "paid_until"):
                self.fields[name].read_only = True
            self.fields.pop("notes")

    def get_plan(self, client):
        plan = client.plan
        if plan is None:
            return None
        return {"id": plan.id, "name": plan.name, "price": str(plan.price), "currency": plan.currency,
                "period": plan.period, "max_sites": plan.max_sites, "monthly_events": plan.monthly_events}

    def get_billing(self, client):
        return billing.status(client)

    def get_role(self, client):
        roles = self.context.get("roles", {})
        return roles.get(client.id, Role.OWNER if self.context.get("is_platform_admin") else None)

    @transaction.atomic
    def create(self, validated_data):
        owner_data = validated_data.pop("owner", None)
        client = Client.objects.create(**validated_data)
        if owner_data:
            try:
                user = resolve_user(owner_data)
            except serializers.ValidationError as exc:
                raise serializers.ValidationError({"owner": exc.detail}) from exc
            Membership.objects.create(client=client, user=user, role=Role.OWNER)
        client.site_count = 0
        client.member_count = 1 if owner_data else 0
        return client

    def update(self, instance, validated_data):
        validated_data.pop("owner", None)
        return super().update(instance, validated_data)


class MembershipSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_login = serializers.DateTimeField(source="user.last_login", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "user_id", "email", "username", "first_name", "role", "last_login", "created_at"]
        read_only_fields = ["id", "created_at"]


class AddMemberSerializer(NewUserSerializer):
    role = serializers.ChoiceField(choices=Role.choices, default=Role.VIEWER)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False)

    def validate_current_password(self, value):
        if not self.context["user"].check_password(value):
            raise serializers.ValidationError("La contraseña actual no es correcta.")
        return value

    def validate_new_password(self, value):
        validate_password(value, self.context["user"])
        return value


class ResetPasswordSerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False)

    def validate_password(self, value):
        validate_password(value, self.context["user"])
        return value


class PaymentSerializer(serializers.ModelSerializer):
    plan_name = serializers.CharField(source="plan.name", read_only=True, default=None)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default=None)
    # Al registrar: correr el vencimiento N períodos del plan (0 = sólo anotar el pago).
    extend_periods = serializers.IntegerField(write_only=True, required=False, default=1, min_value=0, max_value=36)

    class Meta:
        model = Payment
        fields = ["id", "plan", "plan_name", "amount", "currency", "paid_at", "method", "covers_until",
                  "reference", "notes", "created_by_name", "created_at", "extend_periods"]
        read_only_fields = ["id", "plan", "covers_until", "created_at"]

    def validate_amount(self, value):
        if value < 0:
            raise serializers.ValidationError("El monto no puede ser negativo.")
        return value
