from rest_framework.routers import DefaultRouter

from .views import SiteViewSet, TrackingRuleViewSet

router = DefaultRouter()
router.register("sites", SiteViewSet, basename="site")
router.register("tracking-rules", TrackingRuleViewSet, basename="tracking-rule")

urlpatterns = router.urls
