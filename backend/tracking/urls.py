from django.urls import path

from .views import TrackBatchView, TrackingConfigView, TrackView

urlpatterns = [
    path("track/", TrackView.as_view(), name="track"),
    path("track/batch/", TrackBatchView.as_view(), name="track-batch"),
    path("track/config/", TrackingConfigView.as_view(), name="track-config"),
]
