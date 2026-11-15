import "server-only";

import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { generateUniqueOrganizationSlug } from "@/lib/slug";
import { trialPolicy } from "@/lib/brand";
import type { PlanTier } from "@/lib/plans";
import { registerSchema } from "@/modules/auth/schemas";

export const registerOrganizationSchema = registerSchema.extend({
  // Opcional: el nombre del negocio se termina de definir en el onboarding.
  businessName: z.string().trim().max(120).optional(),
});

export type RegisterOrganizationInput = z.infer<typeof registerOrganizationSchema> & {
  /**
   * `true` crea la cuenta con el email ya verificado. Solo corresponde
   * cuando no hay canal para enviar el enlace de verificación (ver
   * modules/auth/email-verification.ts).
   */
  emailVerified?: boolean;
  /**
   * Plan por el que llegó la persona (CTA de la landing). Es solo una intención: no da lugares, no
   * crea suscripción ni cobra nada; la cuenta empieza igual con la prueba gratuita.
   */
  intendedPlan?: PlanTier | null;
};

export type RegisterOrganizationResult =
  | { success: true; userId: string; email: string; name: string }
  | { success: false; error: string };

/**
 * Crea la organización, el usuario propietario y la membresía en una sola
 * transacción, y activa la prueba gratuita (trialPolicy.trialDays) (ver docs/DECISIONS.md
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
        intendedPlan: input.intendedPlan ?? null,
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
