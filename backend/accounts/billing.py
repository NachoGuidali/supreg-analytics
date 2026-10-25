"""Estado de la suscripción de un cliente: plan, vencimiento, avisos y bloqueo por falta de pago.

- Sin fecha de vencimiento: nunca vence (cortesía, clientes internos).
- Faltan BILLING_WARN_DAYS días o menos: "por vencer" (se avisa a la plataforma y a los dueños).
- Pasó la fecha: "vencido". Si BILLING_AUTO_BLOCK está activo y además pasaron BILLING_GRACE_DAYS
  días, el cliente queda bloqueado como si estuviera suspendido (no entra, no registra visitas),
  sin tocar is_active: al registrar el pago se desbloquea solo.
"""

import calendar
from datetime import date, timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone


def today():
    return timezone.localdate()


def config():
    return settings.BILLING


def add_months(day, months):
    month = day.month - 1 + months
    year, month = day.year + month // 12, month % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def status(client, on=None):
    """{"status": none|ok|expiring|overdue|blocked, "days_left": int|None}."""
    on = on or today()
    if client.paid_until is None:
        return {"status": "none", "days_left": None}
    days_left = (client.paid_until - on).days
    if days_left < 0:
        cfg = config()
        blocked = cfg["auto_block"] and -days_left > cfg["grace_days"]
        return {"status": "blocked" if blocked else "overdue", "days_left": days_left}
    if days_left <= config()["warn_days"]:
        return {"status": "expiring", "days_left": days_left}
    return {"status": "ok", "days_left": days_left}


def usable_clients_q(prefix=""):
    """Q de clientes que pueden usar el producto: activos y, con bloqueo automático, no vencidos."""
    q = Q(**{f"{prefix}is_active": True})
    cfg = config()
    if cfg["auto_block"]:
        limit = today() - timedelta(days=cfg["grace_days"])
        q &= Q(**{f"{prefix}paid_until__isnull": True}) | Q(**{f"{prefix}paid_until__gte": limit})
    return q


def next_paid_until(client, months):
    """Extender un período: desde el vencimiento actual si sigue vigente, si no desde hoy."""
    base = client.paid_until if client.paid_until and client.paid_until >= today() else today()
    return add_months(base, months)
