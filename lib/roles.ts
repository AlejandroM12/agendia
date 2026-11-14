import type { MembershipRole } from "@prisma/client";

/** Cómo se llama cada rol en pantalla. */
export const ROLE_LABEL: Record<MembershipRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  professional: "Profesional",
};
