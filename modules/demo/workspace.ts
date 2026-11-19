import "server-only";

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { DEMO, DEMO_SIMULATED_NOTE, type DemoKind } from "./policy";

/**
 * Crea un negocio de demostración completo y aislado: una barbería ficticia con tres profesionales, servicios,
 * horarios, clientes inventados y turnos para los próximos días. Todo cuelga de su propio `Organization`:
 * un visitante nunca comparte datos con otro ni con un negocio real.
 *
 * Los nombres, teléfonos y correos son inventados (`@example.com` y el dominio inexistente de la demo). No se crea
 * suscripción ni se llama a ningún servicio externo.
 */
export type DemoWorkspace = { organizationId: string; slug: string; email: string; password: string; expiresAt: Date };

const TZ = "America/Argentina/Buenos_Aires";

const PROFESSIONALS = [
  { displayName: "Luciano", color: "#b8893b", description: "Cortes clásicos y degradé", days: [1, 2, 3, 4, 5, 6] },
  { displayName: "Martín", color: "#2f5d50", description: "Barba y afeitado clásico", days: [1, 2, 3, 4, 5, 6] },
  { displayName: "Sofía", color: "#9b3d5a", description: "Colorimetría y cortes modernos", days: [2, 3, 4, 5, 6] },
] as const;

const SERVICES = [
  { name: "Corte clásico", durationMinutes: 30, price: 8000 },
  { name: "Corte + barba", durationMinutes: 60, price: 13000 },
  { name: "Barba", durationMinutes: 30, price: 6000 },
  { name: "Afeitado clásico", durationMinutes: 40, price: 9000 },
] as const;

const CUSTOMERS = ["Camila Ruiz", "Tomás Herrera", "Lucía Paredes", "Joaquín Medina", "Agustina Vera", "Nicolás Sosa", "Julieta Funes", "Facundo Ríos"] as const;

/** [días desde hoy, profesional, servicio, cliente, minutos del día]. Sin superposiciones por construcción. */
const AGENDA: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 0, 16 * 60],
  [0, 1, 1, 1, 17 * 60],
  [0, 2, 0, 2, 17 * 60 + 30],
  [1, 0, 1, 3, 10 * 60],
  [1, 1, 2, 4, 11 * 60],
  [1, 2, 3, 5, 15 * 60],
  [2, 0, 0, 6, 12 * 60],
  [2, 1, 1, 7, 16 * 60],
  [3, 0, 3, 0, 10 * 60 + 30],
  [3, 2, 0, 3, 18 * 60],
  [4, 1, 0, 2, 9 * 60 + 30],
  [-1, 0, 0, 5, 11 * 60],
  [-1, 1, 1, 6, 15 * 60],
  [-2, 2, 2, 1, 17 * 60],
];

export async function createDemoWorkspace(options: { kind: DemoKind; allowedRecipients?: string[]; now?: Date }): Promise<DemoWorkspace> {
  const now = options.now ?? new Date();
  const ttlHours = options.kind === "supervised" ? DEMO.supervisedTtlHours : DEMO.publicTtlHours;
  const expiresAt = new Date(now.getTime() + ttlHours * 3600_000);
  const id = randomBytes(5).toString("hex");
  const slug = `demo-${id}`;
  const email = `demo-${id}@${DEMO.emailDomain}`;
  const password = randomBytes(18).toString("base64url");
  const passwordHash = await hashPassword(password);
  const today = todayInTz(TZ, now);

  const organizationId = await db.$transaction(
    async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: "Barbería Don Lucho",
          slug,
          timezone: TZ,
          trialStartedAt: now,
          trialEndsAt: expiresAt,
          onboardingCompletedAt: now,
          industry: "belleza",
          specialty: "Cortes, barba y afeitado clásico",
          description: "Tres profesionales, un solo lugar. Elegí con quién querés atenderte o dejá que te asignemos al primero libre.",
          address: "Calle Muestra 456, Ciudad Ejemplo",
          whatsapp: "5491155550002",
          themePrimary: "#1c1917",
          themeSecondary: "#b8893b",
          themeFont: "fuerte",
          minNoticeMinutes: 0,
          teamModeEnabled: true,
          teamAccountsEnabled: false,
          workMode: "team",
          isDemo: true,
          demoKind: options.kind,
          demoExpiresAt: expiresAt,
          demoAllowedRecipients: (options.allowedRecipients ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean),
        },
      });
      const owner = await tx.user.create({ data: { email, name: "Luciano (demo)", passwordHash, emailVerifiedAt: now } });
      await tx.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "owner", notifyBookings: true } });

      const professionals = [];
      for (const [index, p] of PROFESSIONALS.entries()) {
        const professional = await tx.professional.create({
          data: { organizationId: organization.id, displayName: p.displayName, color: p.color, description: p.description, sortOrder: index, ...(index === 0 ? { userId: owner.id } : {}) },
        });
        await tx.availabilityRule.createMany({
          data: p.days.flatMap((weekday) =>
            [[540, 780], [900, 1140]].map(([startMinute, endMinute]) => ({ organizationId: organization.id, professionalId: professional.id, weekday, startMinute, endMinute })),
          ),
        });
        professionals.push(professional);
      }
      const services = [];
      for (const [index, s] of SERVICES.entries()) {
        services.push(await tx.service.create({ data: { organizationId: organization.id, sortOrder: index, ...s } }));
      }
      const customers = [];
      for (const [index, name] of CUSTOMERS.entries()) {
        customers.push(
          await tx.customer.create({
            data: { organizationId: organization.id, name, email: `cliente${index + 1}@example.com`, phone: `1155550${String(100 + index)}` },
          }),
        );
      }
      for (const [offset, proIndex, serviceIndex, customerIndex, minutes] of AGENDA) {
        const startsAt = zonedTimeToUtc(addDays(today, offset), minutes, TZ);
        const service = services[serviceIndex];
        const past = offset < 0;
        const appointment = await tx.appointment.create({
          data: {
            organizationId: organization.id,
            professionalId: professionals[proIndex].id,
            serviceId: service.id,
            customerId: customers[customerIndex].id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + service.durationMinutes * 60000),
            status: past ? "completed" : "confirmed",
            source: "public_booking",
            manageToken: randomBytes(16).toString("hex"),
            price: service.price,
            professionalSelection: "specific",
            requestedProfessionalId: professionals[proIndex].id,
          },
        });
        if (!past && offset <= 2) {
          // Avisos ya «enviados» (simulados), para que la vista previa de WhatsApp no arranque vacía.
          for (const type of ["booking_confirmation", "reminder"] as const) {
            await tx.notification.create({
              data: {
                organizationId: organization.id,
                appointmentId: appointment.id,
                type,
                channel: "email",
                recipient: customers[customerIndex].email ?? "",
                scheduledFor: now,
                status: "sent",
                sentAt: now,
                lastError: DEMO_SIMULATED_NOTE,
                idempotencyKey: `demo-${organization.id}-${appointment.id}-${type}`,
              },
            });
          }
        }
      }
      return organization.id;
    },
    { timeout: 30_000 },
  );

  return { organizationId, slug, email, password, expiresAt };
}

export async function countActivePublicDemos(): Promise<number> {
  return db.organization.count({ where: { isDemo: true, demoKind: "public", demoExpiresAt: { gt: new Date() } } });
}
