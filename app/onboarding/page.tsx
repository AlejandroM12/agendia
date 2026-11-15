import { primaryProfessionalId } from "@/modules/team/eligibility";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/dal";
import { industries } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { DEFAULT_WEEKLY_RULES } from "@/modules/availability/rules";
import { isTeamModeEnabled } from "@/lib/features";
import { PLAN_CAPABILITIES, TRIAL_MAX_PROFESSIONALS } from "@/lib/plans";
import { BusinessStep, HoursStep, ServicesStep, TeamStep } from "./steps";

export const metadata: Metadata = { title: "Configurá tu agenda" };
export const instant = false;

type StepKey = "business" | "team" | "services" | "hours";
const STEP_INFO: Record<StepKey, { title: string; description: string }> = {
  business: { title: "Tu negocio", description: "Lo básico para armar tu página de reservas." },
  team: { title: "Tu equipo", description: "Quiénes atienden. Es opcional: podés completarlo después desde «Equipo»." },
  services: { title: "Tus servicios", description: "Qué ofrecés y cuánto dura cada cosa. Después podés cambiarlo todo." },
  hours: { title: "Tus horarios", description: "Los días y horarios en los que atendés normalmente." },
};

export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const { organization, permissions } = await requireContext();
  if (organization.onboardingCompletedAt || !permissions.has("settings.manage")) redirect("/dashboard");

  const primaryId = await primaryProfessionalId(db, organization.id);
  const [services, rules] = await Promise.all([
    db.service.findMany({
      where: { organizationId: organization.id },
      orderBy: { sortOrder: "asc" },
      select: { name: true, durationMinutes: true, price: true },
    }),
    db.availabilityRule.findMany({
      where: { organizationId: organization.id, professionalId: primaryId },
      select: { weekday: true, startMinute: true, endMinute: true },
    }),
  ]);

  // Con «trabajo con otras personas» hay un paso más (el equipo). Sin las funciones de equipo, todo queda como siempre.
  const teamFlow = isTeamModeEnabled(organization) && organization.workMode === "team";
  const keys: StepKey[] = teamFlow ? ["business", "team", "services", "hours"] : ["business", "services", "hours"];
  const STEPS = keys.map((key) => STEP_INFO[key]);

  // Se puede retomar: el primer paso sin completar es el punto de partida.
  const firstIncomplete = !organization.industry ? 1 : services.length === 0 ? keys.indexOf("services") + 1 : keys.indexOf("hours") + 1;
  const requested = Number((await props.searchParams).paso);
  const step = requested >= 1 && requested <= firstIncomplete ? requested : firstIncomplete;
  const current = STEPS[step - 1];
  const key = keys[step - 1];
  const teamOn = isTeamModeEnabled(organization);

  const suggested =
    industries.find((i) => i.id === organization.industry)?.services.map((s) => ({ ...s, price: null })) ?? [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-8 sm:py-12">
      <Logo href={null} />

      <ol className="mt-8 flex gap-2" aria-label="Progreso">
        {STEPS.map((s, index) => (
          <li key={s.title} className="flex-1">
            <div
              className={cn("h-1.5 rounded-full", index + 1 <= step ? "bg-primary" : "bg-border")}
              aria-current={index + 1 === step ? "step" : undefined}
            />
            <p className={cn("mt-2 text-xs font-medium", index + 1 === step ? "text-foreground" : "text-muted-foreground")}>
              {index + 1}. {s.title}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-8">
        <h1 className="font-display text-3xl font-semibold text-foreground">{current.title}</h1>
        <p className="mt-2 text-muted-foreground">{current.description}</p>
      </div>

      <div className="mt-7">
        {key === "business" && (
          <BusinessStep name={organization.name} industry={organization.industry} askWorkMode={teamOn} workMode={organization.workMode} />
        )}
        {key === "team" && (
          <TeamStep trialLimit={TRIAL_MAX_PROFESSIONALS} teamLimit={PLAN_CAPABILITIES.equipo.maxActiveProfessionals} />
        )}
        {key === "services" && (
          <ServicesStep initial={services.length ? services : suggested} backStep={keys.indexOf("services")} />
        )}
        {key === "hours" && (
          <HoursStep initialRules={rules.length ? rules : DEFAULT_WEEKLY_RULES} backStep={keys.indexOf("hours")} />
        )}
      </div>
    </main>
  );
}
