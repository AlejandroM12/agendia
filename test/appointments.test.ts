import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import {
  cancelAppointment,
  createAppointment,
  rescheduleAppointment,
  setAppointmentOutcome,
} from "@/modules/appointments/service";
import { getAvailability } from "@/modules/availability/queries";
import { createSchedulableOrganization } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createSchedulableOrganization>>;

describe("turnos", () => {
  let ctx: Ctx;
  let tomorrow: string;
  const at = (minutes: number) => zonedTimeToUtc(tomorrow, minutes, ctx.organization.timezone);
  const guest = (n: number) => ({ name: `Cliente ${n}`, email: `cliente${n}@example.com`, phone: null });

  beforeEach(async () => {
    ctx = await createSchedulableOrganization();
    tomorrow = addDays(todayInTz(ctx.organization.timezone), 1);
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("una reserva pública crea turno, cliente y aparece como horario ocupado", async () => {
    const result = await createAppointment({
      organization: ctx.organization,
      serviceId: ctx.service.id,
      startsAt: at(10 * 60),
      customer: guest(1),
      actor: "customer",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.appointment.source).toBe("public_booking");
    expect(result.appointment.endsAt.getTime() - result.appointment.startsAt.getTime()).toBe(30 * 60000);
    expect(result.appointment.manageToken.length).toBeGreaterThan(20);

    const [day] = await getAvailability({
      organization: ctx.organization,
      durationMinutes: 30,
      fromDateStr: tomorrow,
      days: 1,
    });
    expect(day.slots.some((s) => s.getTime() === at(10 * 60).getTime())).toBe(false);
    expect(day.slots.some((s) => s.getTime() === at(10 * 60 + 30).getTime())).toBe(true);
  });

  it("dos reservas simultáneas del mismo horario: entra exactamente una", async () => {
    const attempts = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        createAppointment({
          organization: ctx.organization,
          serviceId: ctx.service.id,
          startsAt: at(11 * 60),
          customer: guest(n),
          actor: "customer",
        }),
      ),
    );

    expect(attempts.filter((a) => a.ok)).toHaveLength(1);
    for (const failed of attempts.filter((a) => !a.ok)) {
      expect(!failed.ok && ["slot_taken", "unavailable"]).toContain(!failed.ok && failed.code);
    }
    expect(await db.appointment.count({ where: { organizationId: ctx.organization.id } })).toBe(1);
  });

  it("la base rechaza turnos superpuestos aunque se saltee la validación (agenda manual)", async () => {
    const first = await createAppointment({
      organization: ctx.organization,
      serviceId: ctx.service.id,
      startsAt: at(12 * 60),
      customer: guest(1),
      actor: "professional",
    });
    expect(first.ok).toBe(true);

    // Empieza 15 minutos después: se pisa parcialmente con el anterior.
    const overlapping = await createAppointment({
      organization: ctx.organization,
      serviceId: ctx.service.id,
      startsAt: at(12 * 60 + 15),
      customer: guest(2),
      actor: "professional",
    });
    expect(overlapping.ok).toBe(false);
    if (!overlapping.ok) expect(overlapping.code).toBe("slot_taken");

    // Pegado al final (12:30) sí entra: los rangos son [inicio, fin).
    const adjacent = await createAppointment({
      organization: ctx.organization,
      serviceId: ctx.service.id,
      startsAt: at(12 * 60 + 30),
      customer: guest(3),
      actor: "professional",
    });
    expect(adjacent.ok).toBe(true);
  });

  it("la reserva pública rechaza horarios fuera de la disponibilidad", async () => {
    const outsideHours = await createAppointment({
      organization: ctx.organization,
      serviceId: ctx.service.id,
      startsAt: at(22 * 60),
      customer: guest(1),
      actor: "customer",
    });
    expect(outsideHours.ok).toBe(false);
    if (!outsideHours.ok) expect(outsideHours.code).toBe("unavailable");

    const offGrid = await createAppointment({
      organization: ctx.organization,
      serviceId: ctx.service.id,
      startsAt: at(10 * 60 + 7),
      customer: guest(1),
      actor: "customer",
    });
    expect(offGrid.ok).toBe(false);
  });

  it("la reserva pública no acepta servicios inactivos ni de otra organización", async () => {
    await db.service.update({ where: { id: ctx.service.id }, data: { active: false } });
    const inactive = await createAppointment({
      organization: ctx.organization,
      serviceId: ctx.service.id,
      startsAt: at(10 * 60),
      customer: guest(1),
      actor: "customer",
    });
    expect(inactive.ok).toBe(false);

    const other = await createSchedulableOrganization();
    try {
      const foreign = await createAppointment({
        organization: ctx.organization,
        serviceId: other.service.id,
        startsAt: at(10 * 60),
        customer: guest(1),
        actor: "professional",
      });
      expect(foreign.ok).toBe(false);
      if (!foreign.ok) expect(foreign.code).toBe("not_found");
    } finally {
      await other.cleanup();
    }
  });

  it("reutiliza el cliente cuando coincide el email, sin duplicarlo", async () => {
    for (const minutes of [9 * 60, 15 * 60]) {
      const r = await createAppointment({
        organization: ctx.organization,
        serviceId: ctx.service.id,
        startsAt: at(minutes),
        customer: { name: "Ana", email: "ANA@example.com", phone: null },
        actor: "customer",
      });
      expect(r.ok).toBe(true);
    }
    expect(await db.customer.count({ where: { organizationId: ctx.organization.id } })).toBe(1);
  });

  it("reprogramar libera el horario anterior y ocupa el nuevo", async () => {
    const created = await createAppointment({
      organization: ctx.organization,
      serviceId: ctx.service.id,
      startsAt: at(10 * 60),
      customer: guest(1),
      actor: "customer",
    });
    if (!created.ok) throw new Error("setup");

    const moved = await rescheduleAppointment({
      organization: ctx.organization,
      appointmentId: created.appointment.id,
      startsAt: at(16 * 60),
      actor: "customer",
    });
    expect(moved.ok).toBe(true);

    const [day] = await getAvailability({
      organization: ctx.organization,
      durationMinutes: 30,
      fromDateStr: tomorrow,
      days: 1,
    });
    const taken = (m: number) => !day.slots.some((s) => s.getTime() === at(m).getTime());
    expect(taken(10 * 60)).toBe(false);
    expect(taken(16 * 60)).toBe(true);
  });

  it("no se puede reprogramar sobre un horario ocupado por otro turno", async () => {
    const a = await createAppointment({
      organization: ctx.organization, serviceId: ctx.service.id, startsAt: at(10 * 60), customer: guest(1), actor: "professional",
    });
    const b = await createAppointment({
      organization: ctx.organization, serviceId: ctx.service.id, startsAt: at(11 * 60), customer: guest(2), actor: "professional",
    });
    if (!a.ok || !b.ok) throw new Error("setup");

    const clash = await rescheduleAppointment({
      organization: ctx.organization,
      appointmentId: b.appointment.id,
      startsAt: at(10 * 60 + 15),
      actor: "professional",
    });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.code).toBe("slot_taken");
  });

  it("cancelar libera el horario y permite volver a reservarlo", async () => {
    const created = await createAppointment({
      organization: ctx.organization, serviceId: ctx.service.id, startsAt: at(10 * 60), customer: guest(1), actor: "customer",
    });
    if (!created.ok) throw new Error("setup");

    const canceled = await cancelAppointment({
      organization: ctx.organization,
      appointmentId: created.appointment.id,
      actor: "professional",
    });
    expect(canceled.ok && canceled.appointment.status).toBe("canceled");

    const again = await createAppointment({
      organization: ctx.organization, serviceId: ctx.service.id, startsAt: at(10 * 60), customer: guest(2), actor: "customer",
    });
    expect(again.ok).toBe(true);
  });

  it("el cliente no puede cancelar pasado el plazo configurado; el profesional sí", async () => {
    const organization = await db.organization.update({
      where: { id: ctx.organization.id },
      data: { cancellationNoticeHours: 72 },
    });
    const created = await createAppointment({
      organization, serviceId: ctx.service.id, startsAt: at(10 * 60), customer: guest(1), actor: "customer",
    });
    if (!created.ok) throw new Error("setup");

    const byCustomer = await cancelAppointment({ organization, appointmentId: created.appointment.id, actor: "customer" });
    expect(byCustomer.ok).toBe(false);
    if (!byCustomer.ok) expect(byCustomer.code).toBe("too_late");

    const byProfessional = await cancelAppointment({ organization, appointmentId: created.appointment.id, actor: "professional" });
    expect(byProfessional.ok).toBe(true);
  });

  it("una organización no puede operar turnos de otra", async () => {
    const other = await createSchedulableOrganization();
    try {
      const theirs = await createAppointment({
        organization: other.organization, serviceId: other.service.id, startsAt: at(10 * 60), customer: guest(1), actor: "professional",
      });
      if (!theirs.ok) throw new Error("setup");

      const cancel = await cancelAppointment({
        organization: ctx.organization, appointmentId: theirs.appointment.id, actor: "professional",
      });
      const move = await rescheduleAppointment({
        organization: ctx.organization, appointmentId: theirs.appointment.id, startsAt: at(12 * 60), actor: "professional",
      });
      const outcome = await setAppointmentOutcome({
        organizationId: ctx.organization.id, appointmentId: theirs.appointment.id, status: "completed",
      });
      for (const r of [cancel, move, outcome]) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("not_found");
      }

      const untouched = await db.appointment.findUniqueOrThrow({ where: { id: theirs.appointment.id } });
      expect(untouched.status).toBe("confirmed");
    } finally {
      await other.cleanup();
    }
  });
});
