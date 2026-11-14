import "server-only";

import type { Organization } from "@prisma/client";
import type { PublicTeamView } from "@/components/booking/professional-picker";
import { db } from "@/lib/db";
import { listPublicTeam } from "@/modules/team/eligibility";
import { imageUrl } from "./images-client";

/**
 * El equipo tal como lo ve un cliente: solo nombre, descripción breve y foto
 * pública de quienes atienden online, y para cada servicio quiénes lo hacen.
 * Los identificadores de profesional son los que el navegador devuelve al
 * reservar; el servidor los vuelve a validar siempre (eligibilidad, estado,
 * reservas online y negocio), así que no son una credencial.
 */
export async function loadPublicTeamView(organization: Pick<Organization, "id" | "teamModeEnabled">): Promise<PublicTeamView> {
  const team = await listPublicTeam(db, organization);
  return {
    byService: team.byService,
    professionals: team.professionals.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      description: p.description,
      photoUrl: p.photoImageId ? imageUrl(p.photoImageId) : null,
    })),
  };
}
