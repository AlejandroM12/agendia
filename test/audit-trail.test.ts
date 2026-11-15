import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppContext } from "@/lib/dal";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createSchedulableOrganization, fakeContext, uniqueSuffix } from "./helpers";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/dal", async () => (await import("./dal-mock")).createDalMock(() => session.current as AppContext));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { cancelAppointmentAction } from "@/modules/appointments/actions";
import { createAppointment } from "@/modules/appointments/service";
import { saveBookingSettingsAction } from "@/modules/availability/actions";
import { addBlockAction, deleteBlockAction, saveProfessionalHoursAction } from "@/modules/team/actions";
import { ownerProfessional } from "./helpers";

/**
 * Auditoría de cambios de agenda, bloqueos y configuración: cada cambio deja quién, qué y sobre qué,
 * sin datos personales de clientes ni el motivo escrito de un bloqueo.
 */

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
let shop: Tenant;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};
const actions = async () =>
  (await db.auditLog.findMany({ where: { organizationId: shop.organization.id }, orderBy: { createdAt: "asc" } })).map((entry) => entry.action);

beforeAll(async () => {
  shop = await createSchedulableOrganization();
  const organization = await db.organization.findUniqueOrThrow({ where: { id: shop.organization.id } });
  session.current = fakeContext({ userId: shop.userId, email: shop.ownerEmail, organization, role: "owner" });
});
afterAll(async () => {
  await db.auditLog.deleteMany({ where: { organizationId: shop.organization.id } });
  await shop.cleanup();
});

describe("registro de auditoría", () => {
  it("horarios, bloqueos y reglas de reserva quedan registrados, sin el motivo escrito del bloqueo", async () => {
    const owner = await ownerProfessional(shop.organization.id);
    const tz = shop.organization.timezone;
    const day = addDays(todayInTz(tz), 5);

    await saveProfessionalHoursAction(owner.id, undefined, form({ rules: JSON.stringify([{ weekday: 1, startMinute: 540, endMinute: 1020 }]) }));
    const reason = `Motivo privado ${uniqueSuffix()}`;
    await addBlockAction(owner.id, undefined, form({ date: day, fullDay: "on", reason }));
    const block = await db.availabilityException.findFirstOrThrow({ where: { organizationId: shop.organization.id } });
    await deleteBlockAction(owner.id, block.id);
    await saveBookingSettingsAction(undefined, form({ slotIntervalMinutes: "15", bufferMinutes: "0", minNoticeMinutes: "0", maxAdvanceDays: "60", cancellationNoticeHours: "24" }));

    expect(await actions()).toEqual(["schedule.hours.update", "schedule.block.create", "schedule.block.delete", "settings.booking.update"]);
    const entries = await db.auditLog.findMany({ where: { organizationId: shop.organization.id } });
    expect(entries.every((entry) => entry.userId === shop.userId)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain(reason);
    expect(entries.find((e) => e.action === "settings.booking.update")?.metadata).toMatchObject({ changed: expect.arrayContaining(["slotIntervalMinutes"]) });
  });

  it("cancelar un turno desde el panel deja registro, sin datos del cliente", async () => {
    const tz = shop.organization.timezone;
    const created = await createAppointment({
      organization: shop.organization,
      serviceId: shop.service.id,
      startsAt: zonedTimeToUtc(addDays(todayInTz(tz), 3), 600, tz),
      customer: { name: "Cliente Privado", email: "privado@example.com", phone: "1144443333" },
      actor: "professional",
    });
    if (!created.ok) throw new Error("no se creó");
    await cancelAppointmentAction(created.appointment.id);
    const entry = await db.auditLog.findFirstOrThrow({ where: { organizationId: shop.organization.id, action: "appointment.cancel" } });
    expect(entry).toMatchObject({ entityType: "appointment", entityId: created.appointment.id, userId: shop.userId });
    expect(JSON.stringify(entry)).not.toMatch(/Cliente Privado|privado@example\.com|1144443333/);
  });
});
