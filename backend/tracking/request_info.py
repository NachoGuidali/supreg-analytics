"""Datos derivados de la request: tipo de dispositivo, bots, IP y país."""

import logging
import os
import re
from functools import lru_cache

from django.conf import settings

from .models import DeviceType

logger = logging.getLogger(__name__)

_BOT_RE = re.compile(r"bot|crawl|spider|slurp|headlesschrome|lighthouse|phantomjs", re.I)
_TABLET_RE = re.compile(r"ipad|tablet|kindle|silk|playbook|android(?!.*mobile)", re.I)
_MOBILE_RE = re.compile(r"mobi|iphone|ipod|android|blackberry|opera mini|iemobile", re.I)


def is_bot(user_agent):
    return not user_agent or bool(_BOT_RE.search(user_agent))


def device_type_from_user_agent(user_agent):
    # Limitación conocida: iPadOS 13+ se presenta como Mac y cae en desktop.
    if _TABLET_RE.search(user_agent or ""):
        return DeviceType.TABLET
    if _MOBILE_RE.search(user_agent or ""):
        return DeviceType.MOBILE
    return DeviceType.DESKTOP


def _trust_proxy():
    return settings.TRACKING["TRUST_PROXY_HEADERS"]


def client_ip(request):
    if _trust_proxy():
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


@lru_cache(maxsize=1)
def _geoip_reader():
    path = settings.TRACKING["GEOIP_PATH"]
    if not path or not os.path.exists(path):
        return None
    import geoip2.database

    logger.info("GeoIP habilitado con %s", path)
    return geoip2.database.Reader(path)


def country_from_request(request):
    """ISO-3166 alpha-2 o None. La IP no se persiste."""
    if _trust_proxy():
        cf_country = request.headers.get("CF-IPCountry", "").upper()
        if len(cf_country) == 2 and cf_country not in {"XX", "T1"}:
            return cf_country

    reader = _geoip_reader()
    ip = client_ip(request)
    if reader is None or not ip:
        return None

    import geoip2.errors

    try:
        return reader.country(ip).country.iso_code
    except (geoip2.errors.AddressNotFoundError, ValueError):
        return None
