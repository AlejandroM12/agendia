import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/dal";
import { industries } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { DEFAULT_WEEKLY_RULES } from "@/modules/availability/rules";
import { BusinessStep, HoursStep, ServicesStep } from "./steps";

export const metadata: Metadata = { title: "Configurá tu agenda" };
export const instant = false;

const STEPS = [
  { title: "Tu negocio", description: "Lo básico para armar tu página de reservas." },
  { title: "Tus servicios", description: "Qué ofrecés y cuánto dura cada cosa. Después podés cambiarlo todo." },
  { title: "Tus horarios", description: "Los días y horarios en los que atendés normalmente." },
];

export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const { organization } = await requireContext();
  if (organization.onboardingCompletedAt) redirect("/dashboard");

  const [services, rules] = await Promise.all([
    db.service.findMany({
      where: { organizationId: organization.id },
      orderBy: { sortOrder: "asc" },
      select: { name: true, durationMinutes: true, price: true },
    }),
    db.availabilityRule.findMany({
      where: { organizationId: organization.id },
      select: { weekday: true, startMinute: true, endMinute: true },
    }),
  ]);

  // Se puede retomar: el primer paso sin completar es el punto de partida.
  const firstIncomplete = !organization.industry ? 1 : services.length === 0 ? 2 : 3;
  const requested = Number((await props.searchParams).paso);
  const step = requested >= 1 && requested <= firstIncomplete ? requested : firstIncomplete;
  const current = STEPS[step - 1];

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
        {step === 1 && <BusinessStep name={organization.name} industry={organization.industry} />}
        {step === 2 && <ServicesStep initial={services.length ? services : suggested} />}
        {step === 3 && <HoursStep initialRules={rules.length ? rules : DEFAULT_WEEKLY_RULES} />}
      </div>
    </main>
  );
}
