"""Motor de análisis: traduce una config JSON a queries sobre Event.

Uso:
    run_analysis(site, "trend", config, "2026-09-01", "2026-09-30")
"""

from .base import REGISTRY, Analysis, get_analysis_class, register, run_analysis, validate_config
from .errors import ConfigError

# Cada módulo registra su tipo al importarse.
from . import breakdown, funnel, metric, retention, trend  # noqa: E402,F401

__all__ = [
    "REGISTRY",
    "Analysis",
    "ConfigError",
    "get_analysis_class",
    "register",
    "run_analysis",
    "validate_config",
]
