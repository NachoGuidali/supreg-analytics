import uuid

from django.conf import settings
from django.db import models


class Role(models.TextChoices):
    """Ordenados de menor a mayor: cada rol puede todo lo del anterior."""

    VIEWER = "viewer", "Lector"
    EDITOR = "editor", "Editor"
    OWNER = "owner", "Dueño"


ROLE_RANK = {Role.VIEWER: 0, Role.EDITOR: 1, Role.OWNER: 2}


def roles_at_least(role):
    return [r for r, rank in ROLE_RANK.items() if rank >= ROLE_RANK[role]]


class Plan(models.Model):
    """Plan comercial. Lo administra la plataforma; cada cliente tiene uno (o ninguno: cortesía)."""

    class Period(models.TextChoices):
        MONTHLY = "monthly", "Mensual"
        YEARLY = "yearly", "Anual"

    name = models.CharField(max_length=80)
    description = models.CharField(max_length=300, blank=True, default="")
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default="ARS")
    period = models.CharField(max_length=10, choices=Period.choices, default=Period.MONTHLY)
    max_sites = models.PositiveIntegerField(null=True, blank=True, help_text="Vacío = sin límite.")
    monthly_events = models.PositiveIntegerField(null=True, blank=True, help_text="Referencia de uso. Vacío = sin límite.")
    is_active = models.BooleanField(default=True, help_text="Los planes inactivos no se ofrecen para clientes nuevos.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["price", "name"]

    def __str__(self):
        return self.name

    @property
    def months(self):
        return 12 if self.period == self.Period.YEARLY else 1


class Client(models.Model):
    """Tenant: una empresa o persona con sus sitios y su equipo.

    Todo lo demás cuelga de Site.client, así que filtrar por sitio alcanza para aislar
    los datos de cada cliente.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    is_active = models.BooleanField(
        default=True,
        help_text="Un cliente suspendido no puede entrar al dashboard y sus sitios dejan de recibir eventos.",
    )
    notes = models.TextField(blank=True, default="", help_text="Notas internas, sólo para la plataforma.")
    plan = models.ForeignKey(Plan, null=True, blank=True, on_delete=models.PROTECT, related_name="clients")
    paid_until = models.DateField(null=True, blank=True, help_text="Vencimiento del plan. Vacío = sin vencimiento.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Payment(models.Model):
    """Pago registrado de un cliente. Hoy se cargan a mano; un checkout los crearía solo."""

    class Method(models.TextChoices):
        TRANSFER = "transfer", "Transferencia"
        MERCADOPAGO = "mercadopago", "Mercado Pago"
        CASH = "cash", "Efectivo"
        OTHER = "other", "Otro"

    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="payments")
    plan = models.ForeignKey(Plan, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default="ARS")
    paid_at = models.DateField()
    method = models.CharField(max_length=12, choices=Method.choices, default=Method.TRANSFER)
    # Vencimiento que quedó después de este pago (para el historial).
    covers_until = models.DateField(null=True, blank=True)
    reference = models.CharField(max_length=120, blank=True, default="", help_text="Nro. de operación o comprobante.")
    notes = models.CharField(max_length=300, blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-paid_at", "-created_at"]

    def __str__(self):
        return f"{self.client} {self.amount} {self.currency} ({self.paid_at})"


class Membership(models.Model):
    """Un usuario puede pertenecer a varios clientes (por ejemplo, una agencia)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.VIEWER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["client__name", "user__username"]
        constraints = [
            models.UniqueConstraint(fields=["user", "client"], name="membership_user_client_unique"),
        ]

    def __str__(self):
        return f"{self.user} → {self.client} ({self.role})"
