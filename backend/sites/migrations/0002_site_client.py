import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def assign_existing_sites(apps, schema_editor):
    """Instalaciones previas (un solo tenant): sus sitios pasan a un cliente inicial y
    los usuarios staff que no son superusuarios quedan como dueños de ese cliente."""
    Site = apps.get_model("sites", "Site")
    if not Site.objects.exists():
        return
    Client = apps.get_model("accounts", "Client")
    Membership = apps.get_model("accounts", "Membership")
    User = apps.get_model(settings.AUTH_USER_MODEL)
    client = Client.objects.create(name="Cliente inicial")
    Site.objects.update(client=client)
    for user in User.objects.filter(is_staff=True, is_superuser=False):
        Membership.objects.create(client=client, user=user, role="owner")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
        ("sites", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="site",
            name="client",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name="sites", to="accounts.client"),
        ),
        migrations.RunPython(assign_existing_sites, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="site",
            name="client",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="sites", to="accounts.client"),
        ),
    ]
