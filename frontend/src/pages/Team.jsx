import TeamManager from "../components/TeamManager";
import { EmptyState, PageHeader } from "../components/ui";
import { useApp } from "../state/AppContext";

/** Equipo del cliente del sitio elegido. Sin sitios, el del primer cliente del usuario. */
export default function Team() {
  const { site, user, roleIn } = useApp();
  const membership = user?.memberships?.[0];
  const clientId = site?.client_id || membership?.client_id;
  const clientName = site?.client_name || membership?.client_name;

  if (!clientId) {
    return <EmptyState title="Elegí un sitio">El equipo se gestiona por cliente: elegí uno de sus sitios en el selector.</EmptyState>;
  }
  const clientCount = new Set(user?.memberships?.map((m) => m.client_id)).size;
  return (
    <div className="space-y-5">
      <PageHeader
        title={`Equipo de ${clientName}`}
        description={
          clientCount > 1
            ? "Quiénes ven los sitios de este cliente. Para ver el equipo de otro cliente, elegí uno de sus sitios."
            : "Quiénes ven los sitios de este cliente y qué puede hacer cada uno."
        }
      />
      <TeamManager key={clientId} clientId={clientId} clientName={clientName} canManage={roleIn(clientId) === "owner"} />
    </div>
  );
}
