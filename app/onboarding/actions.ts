"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireWriteContext } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { industries } from "@/lib/brand";
import { generateUniqueOrganizationSlug } from "@/lib/slug";
import { presetForIndustry } from "@/lib/theme";
import { getOrCreatePrimaryProfessional } from "@/modules/team/eligibility";
import { saveProfessionalHours } from "@/modules/team/professionals";
import { parseJsonField, weeklyRulesSchema } from "@/modules/availability/rules";
import { serviceListSchema } from "@/modules/services/schema";

const businessSchema = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre de tu negocio.").max(80),
  industry: z.string().refine((v) => industries.some((i) => i.id === v), "Elegí una actividad."),
});

/**
 * Los pasos del onboarding solo valen mientras está pendiente. Una vez
 * terminado, servicios y horarios se administran desde el panel: si no,
 * reenviar el paso 2 reemplazaría toda la lista de servicios.
 */
async function requireOnboardingContext() {
  const access = await requireWriteContext();
  if (access.ok && access.context.organization.onboardingCompletedAt) redirect("/dashboard");
  return access;
}

export async function saveBusinessStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireOnboardingContext();
  if (!access.ok) return { message: access.message };
  const { organization } = access.context;

  const parsed = businessSchema.safeParse({
    name: formData.get("name"),
    industry: formData.get("industry"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  // El enlace público se deriva del nombre mientras dure el onboarding;
  // después solo cambia si el profesional lo edita a mano.
  const slug =
    parsed.data.name === organization.name
      ? organization.slug
      : await generateUniqueOrganizationSlug(parsed.data.name);

  const preset = presetForIndustry(parsed.data.industry);
  await db.organization.update({
    where: { id: organization.id },
    data: {
      name: parsed.data.name,
      industry: parsed.data.industry,
      slug,
      // Punto de partida visual según el rubro; se cambia en «Mi página pública».
      themePrimary: preset.primary,
      themeSecondary: preset.secondary,
      themeFont: preset.font,
    },
  });

  redirect("/onboarding?paso=2");
}

export async function saveServicesStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireOnboardingContext();
  if (!access.ok) return { message: access.message };
  const { organization } = access.context;

  const parsed = parseJsonField(serviceListSchema, formData.get("services"));
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Revisá los servicios ingresados." };
  }

  await db.$transaction(async (tx) => {
    // Durante el onboarding todavía no hay turnos: se reemplaza la lista.
    const used = await tx.appointment.count({ where: { organizationId: organization.id } });
    if (used === 0) await tx.service.deleteMany({ where: { organizationId: organization.id } });
    await tx.service.createMany({
      data: parsed.data.map((service, index) => ({
        organizationId: organization.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        price: service.price,
        sortOrder: index,
      })),
    });
  });

  redirect("/onboarding?paso=3");
}

export async function saveHoursStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireOnboardingContext();
  if (!access.ok) return { message: access.message };
  const { organization } = access.context;

  const parsed = parseJsonField(weeklyRulesSchema, formData.get("rules"));
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Revisá los horarios ingresados." };
  }
  if (parsed.data.length === 0) {
    return { message: "Marcá al menos un día de atención." };
  }

  const serviceCount = await db.service.count({ where: { organizationId: organization.id } });
  if (serviceCount === 0) redirect("/onboarding?paso=2");

  const primary = await getOrCreatePrimaryProfessional(db, organization);
  if (!primary) return { message: "No pudimos guardar tus horarios. Escribinos para resolverlo." };
  const saved = await saveProfessionalHours(organization, primary.id, parsed.data, [
    db.organization.update({
      where: { id: organization.id },
      data: { onboardingCompletedAt: new Date() },
    }),
  ]);
  if (!saved.ok) return { message: saved.message };

  redirect("/dashboard?bienvenida=1");
}
