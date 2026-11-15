import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import sharp from "sharp";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createAppointment, reassignAppointment } from "@/modules/appointments/service";
import { saveProfessionalPhoto } from "@/modules/public-page/images";
import { addProfessional, createSchedulableOrganization, enableTeam, ownerProfessional, refreshOrganization } from "./helpers";

/**
 * Preparar la vuelta a una versión anterior (scripts/prepare-rollback.mjs): las
 * filas que la versión anterior no entiende se APARTAN, no se borran, y se
 * pueden restaurar. Contra PostgreSQL real.
 */

type Script = {
  inspect: (client: pg.Client) => Promise<{ photos: number; notices: number; members: number }>;
  apply: (client: pg.Client) => Promise<{ photosMoved: number; noticesConverted: number; membersMoved: number }>;
  restore: (client: pg.Client) => Promise<{ photosRestored: number; noticesRestored: number; membersRestored: number }>;
};

let script: Script;
let client: pg.Client;
let shop: Awaited<ReturnType<typeof createSchedulableOrganization>>;

beforeAll(async () => {
  script = (await import(/* @vite-ignore */ pathToFileURL(resolve("scripts/prepare-rollback.mjs")).href)) as Script;
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  shop = await createSchedulableOrganization();
});

afterAll(async () => {
  await shop?.cleanup();
  await client.query('DROP TABLE IF EXISTS "rollback_backup_professional_images"');
  await client.query('DROP TABLE IF EXISTS "rollback_backup_notifications"');
  await client.query('DROP TABLE IF EXISTS "rollback_backup_memberships"');
  await client.end();
});

describe("preparar el rollback sin perder datos", () => {
  it("aparta fotos y avisos nuevos, deja la base legible por la versión anterior y se puede revertir", async () => {
    await enableTeam(shop.organization.id, { extraProfessionals: 3 });
    const owner = await ownerProfessional(shop.organization.id);
    const second = await addProfessional(shop.organization.id, { displayName: "Martín" });
    const photo = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#456" } }).png().toBuffer();
    const saved = await saveProfessionalPhoto(shop.organization.id, second.id, new Uint8Array(photo));
    expect(saved.ok).toBe(true);
    // Un logo del negocio que NO debe tocarse.
    await db.organizationImage.create({
      data: { organizationId: shop.organization.id, kind: "logo", contentType: "image/webp", width: 1, height: 1, bytes: new Uint8Array([1, 2, 3]) },
    });

    const tz = shop.organization.timezone;
    const created = await createAppointment({
      organization: await refreshOrganization(shop.organization.id),
      serviceId: shop.service.id,
      startsAt: zonedTimeToUtc(addDays(todayInTz(tz), 3), 10 * 60, tz),
      customer: { name: "Cliente", email: "cliente@example.com", phone: null },
      actor: "professional",
      professional: owner.id,
    });
    expect(created.ok).toBe(true);
    const appointmentId = created.ok ? created.appointment.id : "";
    expect((await reassignAppointment({ organization: await refreshOrganization(shop.organization.id), appointmentId, professionalId: second.id })).ok).toBe(true);
    const noticeCount = () => db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM notifications WHERE "appointmentId" = ${appointmentId} AND "type"::text = 'professional_change'`;
    expect(Number((await noticeCount())[0].n)).toBe(1);

    // Un profesional con cuenta y un administrador invitado, que la versión anterior no entiende.
    const proUser = await db.user.create({ data: { email: `rb-pro-${Date.now()}@example.com`, name: "Pro", passwordHash: "x" } });
    const adminUser = await db.user.create({ data: { email: `rb-admin-${Date.now()}@example.com`, name: "Admin", passwordHash: "x" } });
    await db.membership.create({ data: { organizationId: shop.organization.id, userId: proUser.id, role: "professional" } });
    await db.membership.create({ data: { organizationId: shop.organization.id, userId: adminUser.id, role: "admin", notifyBookings: false } });
    await db.professional.update({ where: { id: owner.id }, data: { userId: proUser.id } });

    // 1. Solo informa.
    const before = await script.inspect(client);
    expect(before.photos).toBeGreaterThanOrEqual(1);
    expect(before.notices).toBeGreaterThanOrEqual(1);
    expect(before.members).toBeGreaterThanOrEqual(2);
    expect(Number((await noticeCount())[0].n)).toBe(1);

    // 2. Aplica: no queda ninguna fila que la versión anterior no conozca, y nada se perdió.
    const applied = await script.apply(client);
    expect(applied.photosMoved).toBeGreaterThanOrEqual(1);
    expect(await script.inspect(client)).toEqual({ photos: 0, notices: 0, members: 0 });
    // Solo queda el propietario: nadie conserva un acceso que la versión anterior malinterpretaría.
    expect((await db.membership.findMany({ where: { organizationId: shop.organization.id } })).map((m) => m.role)).toEqual(["owner"]);
    expect((await db.professional.findUniqueOrThrow({ where: { id: owner.id } })).userId).toBeNull(); // el perfil se conserva, sin cuenta
    expect((await client.query(`SELECT count(*)::int AS n FROM "rollback_backup_memberships" WHERE "organizationId" = $1`, [shop.organization.id])).rows[0].n).toBe(2);
    expect(await db.organizationImage.count({ where: { organizationId: shop.organization.id } })).toBe(1); // solo el logo
    expect((await db.professional.findUniqueOrThrow({ where: { id: second.id } })).photoImageId).toBeNull();
    expect((await client.query(`SELECT count(*)::int AS n FROM "rollback_backup_professional_images" WHERE "organizationId" = $1`, [shop.organization.id])).rows[0].n).toBe(1);
    const converted = await db.notification.findMany({ where: { appointmentId } });
    expect(converted.some((n) => n.type === "reschedule" && n.status === "canceled")).toBe(true);
    // El turno, el profesional y el resto de los datos siguen intactos.
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).professionalId).toBe(second.id);
    expect(await db.professional.count({ where: { organizationId: shop.organization.id } })).toBe(2);

    // 3. Es repetible: una segunda vez no hace nada.
    expect(await script.apply(client)).toEqual({ photosMoved: 0, noticesConverted: 0, membersMoved: 0 });

    // 4. Restaura: vuelve la foto con su profesional y el tipo de aviso original.
    const restored = await script.restore(client);
    expect(restored.photosRestored).toBeGreaterThanOrEqual(1);
    const restoredPhoto = await db.professional.findUniqueOrThrow({ where: { id: second.id }, select: { photoImageId: true } });
    expect(restoredPhoto.photoImageId).toBe(saved.ok ? saved.id : "");
    expect(Number((await noticeCount())[0].n)).toBe(1);
    // Y devuelve los accesos con su vínculo.
    expect(restored.membersRestored).toBeGreaterThanOrEqual(2);
    expect((await db.membership.findMany({ where: { organizationId: shop.organization.id } })).map((m) => m.role).sort()).toEqual(["admin", "owner", "professional"]);
    expect((await db.professional.findUniqueOrThrow({ where: { id: owner.id } })).userId).toBe(proUser.id);
    expect((await db.membership.findFirstOrThrow({ where: { organizationId: shop.organization.id, userId: adminUser.id } })).notifyBookings).toBe(false);
    await db.user.deleteMany({ where: { id: { in: [proUser.id, adminUser.id] } } });
  });
});
