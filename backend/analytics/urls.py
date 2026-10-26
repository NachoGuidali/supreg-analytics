from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("analyses", views.SavedAnalysisViewSet, basename="analysis")
router.register("goals", views.GoalViewSet, basename="goal")
router.register("event-definitions", views.EventDefinitionViewSet, basename="event-definition")
router.register("dashboards", views.DashboardViewSet, basename="dashboard")

urlpatterns = [
    path("analysis/run/", views.RunAnalysisView.as_view(), name="analysis-run"),
    path("events/names/", views.EventNamesView.as_view(), name="event-names"),
    path("events/properties/", views.EventPropertiesView.as_view(), name="event-properties"),
    path("events/recent/", views.RecentEventsView.as_view(), name="events-recent"),
    path("events/catalog/", views.EventCatalogView.as_view(), name="event-catalog"),
    path("overview/", views.OverviewView.as_view(), name="overview"),
    path("reports/acquisition/", views.AcquisitionReportView.as_view(), name="report-acquisition"),
    path("reports/campaign/", views.CampaignReportView.as_view(), name="report-campaign"),
    path("reports/behavior/", views.BehaviorReportView.as_view(), name="report-behavior"),
    path("reports/audience/", views.AudienceReportView.as_view(), name="report-audience"),
    path("insights/", views.InsightsView.as_view(), name="insights"),
    *router.urls,
]
