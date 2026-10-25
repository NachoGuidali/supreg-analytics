import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Client",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=150)),
                ("is_active", models.BooleanField(default=True, help_text="Un cliente suspendido no puede entrar al dashboard y sus sitios dejan de recibir eventos.")),
                ("notes", models.TextField(blank=True, default="", help_text="Notas internas, sólo para la plataforma.")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="Membership",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(choices=[("viewer", "Lector"), ("editor", "Editor"), ("owner", "Dueño")], default="viewer", max_length=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("client", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="accounts.client")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["client__name", "user__username"],
                "constraints": [models.UniqueConstraint(fields=("user", "client"), name="membership_user_client_unique")],
            },
        ),
    ]
