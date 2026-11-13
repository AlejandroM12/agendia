import "server-only";

import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { generateUniqueOrganizationSlug } from "@/lib/slug";
import { trialPolicy } from "@/lib/brand";

export const registerOrganizationSchema = z.object({
  // Opcional: el nombre del negocio se termina de definir en el onboarding.
  businessName: z.string().trim().max(120).optional(),
  name: z.string().trim().min(2, "Ingresá tu nombre.").max(120),
  email: z.email("Ingresá un email válido.").trim().toLowerCase(),
  password: z
    .string()
    .min(8, "Debe tener al menos 8 caracteres.")
    .regex(/[a-zA-Z]/, "Debe contener al menos una letra.")
    .regex(/[0-9]/, "Debe contener al menos un número."),
});

export type RegisterOrganizationInput = z.infer<typeof registerOrganizationSchema> & {
  /**
   * `true` crea la cuenta con el email ya verificado. Solo corresponde
   * cuando no hay canal para enviar el enlace de verificación (ver
   * modules/auth/email-verification.ts).
   */
  emailVerified?: boolean;
};

export type RegisterOrganizationResult =
  | { success: true; userId: string; email: string; name: string }
  | { success: false; error: string };

/**
 * Crea la organización, el usuario propietario y la membresía en una sola
 * transacción, y activa la prueba gratuita de 7 días (ver docs/DECISIONS.md
 * D-07 y D-09: el ciclo de prueba se implementa junto con el registro,
 * independientemente de que el cobro real todavía no exista).
 */
export async function registerOrganization(
  input: RegisterOrganizationInput,
): Promise<RegisterOrganizationResult> {
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) {
    return { success: false, error: "Ya existe una cuenta con ese email." };
  }

  const businessName = input.businessName || input.name;
  const [passwordHash, slug] = await Promise.all([
    hashPassword(input.password),
    generateUniqueOrganizationSlug(businessName),
  ]);

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + trialPolicy.trialDays * 24 * 60 * 60 * 1000);

  const user = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: businessName,
        slug,
        trialStartedAt: now,
        trialEndsAt,
      },
    });

    const createdUser = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        emailVerifiedAt: input.emailVerified ? now : null,
      },
    });

    await tx.membership.create({
      data: {
        organizationId: organization.id,
        userId: createdUser.id,
        role: "owner",
      },
    });

    // Regla del MVP: un profesional activo por organización.
    await tx.professional.create({
      data: { organizationId: organization.id, displayName: input.name },
    });

    return createdUser;
  });

  return { success: true, userId: user.id, email: user.email, name: user.name };
}
