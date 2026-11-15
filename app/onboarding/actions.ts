"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireWriteContext } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { industries } from "@/lib/brand";
import { isTeamModeEnabled } from "@/lib/features";
import { generateUniqueOrganizationSlug } from "@/lib/slug";
import { presetForIndustry } from "@/lib/theme";
import { getOrCreatePrimaryProfessional } from "@/modules/team/eligibility";
import { createProfessional, saveProfessionalHours, setProfessionalActive } from "@/modules/team/professionals";
import { parseJsonField, weeklyRulesSchema } from "@/modules/availability/rules";
import { serviceListSchema } from "@/modules/services/schema";

const businessSchema = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre de tu negocio.").max(80),
  industry: z.string().refine((v) => industries.some((i) => i.id === v), "Elegí una actividad."),
  workMode: z.enum(["solo", "team"]).optional(),
});

/**
 * Los pasos del onboarding solo valen mientras está pendiente. Una vez
 * terminado, servicios y horarios se administran desde el panel: si no,
 * reenviar el paso 2 reemplazaría toda la lista de servicios.
 */
async function requireOnboardingContext() {
  const access = await requireWriteContext("settings.manage");
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
    workMode: formData.get("workMode") || undefined,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  // «¿Cómo trabajás?» solo existe si el negocio puede usar equipos; si no, siempre es «por mi cuenta».
  const workMode = isTeamModeEnabled(organization) ? (parsed.data.workMode ?? "solo") : "solo";

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
      workMode,
      slug,
      // Punto de partida visual según el rubro; se cambia en «Mi página pública».
      themePrimary: preset.primary,
      themeSecondary: preset.secondary,
      themeFont: preset.font,
    },
  });

  redirect("/onboarding?paso=2");
}

const teamStepSchema = z.object({
  ownerAttends: z.enum(["yes", "no"]),
  names: z.string().max(600),
});

/**
 * Paso «Tu equipo» (solo «trabajo con otras personas»): si quien administra también atiende y quiénes
 * más atienden. Es opcional y se puede completar después desde «Equipo»: no obliga a invitar a nadie,
 * cargar fotos ni todos los servicios. Los lugares los limita el plan (en la prueba, 2 profesionales).
 */
export async function saveTeamStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireOnboardingContext();
  if (!access.ok) return { message: access.message };
  const { organization } = access.context;
  if (!isTeamModeEnabled(organization)) redirect("/onboarding?paso=2");

  if (formData.get("skip") === "1") redirect("/onboarding?paso=3");

  const parsed = teamStepSchema.safeParse({ ownerAttends: formData.get("ownerAttends"), names: formData.get("names") ?? "" });
  if (!parsed.success) return { message: "Contanos si vos también atendés." };

  const names = [
    ...new Set(
      parsed.data.names
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  if (names.some((name) => name.length < 2 || name.length > 80)) {
    return { message: "Cada nombre tiene que tener entre 2 y 80 caracteres." };
  }
  if (parsed.data.ownerAttends === "no" && names.length === 0) {
    return { message: "Agregá al menos a un profesional o indicá que atendés vos. Si preferís, completalo después." };
  }

  // El profesional de quien registró el negocio es el más antiguo (lo crea el registro).
  const ownerPro = await db.professional.findFirst({
    where: { organizationId: organization.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!ownerPro) return { message: "No pudimos guardar tu equipo. Escribinos para resolverlo." };

  // Quien administra pero no atiende no ocupa lugar: se desactiva primero su profesional (todavía sin
  // turnos), así los lugares alcanzan para quienes sí atienden.
  const attends = parsed.data.ownerAttends === "yes";
  const toggledOwner = ownerPro.active !== attends;
  if (toggledOwner) {
    const toggled = await setProfessionalActive(organization, ownerPro.id, attends);
    if (!toggled.ok) return { message: toggled.message };
  }

  const existing = await db.professional.findMany({ where: { organizationId: organization.id }, select: { displayName: true } });
  const known = new Set(existing.map((p) => p.displayName.toLowerCase()));
  for (const name of names) {
    if (known.has(name.toLowerCase())) continue;
    const created = await createProfessional(organization, { displayName: name });
    if (!created.ok) {
      // Si no se pudo sumar a nadie, el negocio no se queda sin profesional activo.
      if (toggledOwner && !attends) await setProfessionalActive(organization, ownerPro.id, true);
      return { message: created.message };
    }
    known.add(name.toLowerCase());
  }

  redirect("/onboarding?paso=3");
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

  redirect(`/onboarding?paso=${organization.workMode === "team" ? 4 : 3}`);
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
  if (serviceCount === 0) redirect(`/onboarding?paso=${organization.workMode === "team" ? 3 : 2}`);

  const primary = await getOrCreatePrimaryProfessional(db, organization);
  if (!primary) return { message: "No pudimos guardar tus horarios. Escribinos para resolverlo." };
  const saved = await saveProfessionalHours(organization, primary.id, parsed.data, [
    db.organization.update({
      where: { id: organization.id },
      data: { onboardingCompletedAt: new Date() },
    }),
  ]);
  if (!saved.ok) return { message: saved.message };

  // Con equipo, el horario habitual también queda para los demás profesionales que todavía no tienen
  // uno: después se ajusta profesional por profesional desde «Equipo».
  if (organization.workMode === "team") {
    const others = await db.professional.findMany({
      where: { organizationId: organization.id, active: true, id: { not: primary.id }, availabilityRules: { none: {} } },
      select: { id: true },
    });
    for (const other of others) await saveProfessionalHours(organization, other.id, parsed.data);
  }

  redirect("/dashboard?bienvenida=1");
}
