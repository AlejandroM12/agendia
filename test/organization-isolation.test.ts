import { describe, it, expect, afterEach } from "vitest";
import { registerOrganization } from "@/modules/organizations/register";
import { getOrganizationWithSyncedStatus } from "@/lib/organization-access";
import { db } from "@/lib/db";
import { cleanupOrganization, cleanupUser, uniqueSuffix } from "./helpers";

/**
 * Aislamiento multi-tenant (Fase 1).
 *
 * Todavía no existen entidades operativas propias de cada organización
 * (Customer, Appointment, etc. llegan en la Fase 3), así que lo que se
 * puede verificar hoy es el límite real que ya existe: Organization,
 * User y Membership. La garantía de fondo es que una organización nunca
 * se identifica por un parámetro que venga del cliente, sino por el
 * `organizationId` resuelto del lado del servidor a partir de la sesión
 * (ver lib/dal.ts) — por eso este test verifica que la membresía de un
 * usuario no apunte nunca a la organización de otro.
 */
describe("aislamiento entre organizaciones", () => {
  let userAId: string | undefined;
  let orgAId: string | undefined;
  let userBId: string | undefined;
  let orgBId: string | undefined;

  afterEach(async () => {
    await cleanupUser(userAId);
    await cleanupOrganization(orgAId);
    await cleanupUser(userBId);
    await cleanupOrganization(orgBId);
    userAId = orgAId = userBId = orgBId = undefined;
  });

  async function createTwoIndependentOrganizations() {
    const suffix = uniqueSuffix();

    const resultA = await registerOrganization({
      businessName: `Org A ${suffix}`,
      name: "Owner A",
      email: `owner-a-${suffix}@example.com`,
      password: "ContrasenaA123",
    });
    const resultB = await registerOrganization({
      businessName: `Org B ${suffix}`,
      name: "Owner B",
      email: `owner-b-${suffix}@example.com`,
      password: "ContrasenaB123",
    });

    if (!resultA.success || !resultB.success) {
      throw new Error("No se pudieron crear las organizaciones de prueba");
    }

    userAId = resultA.userId;
    userBId = resultB.userId;

    const membershipA = await db.membership.findFirstOrThrow({ where: { userId: userAId } });
    const membershipB = await db.membership.findFirstOrThrow({ where: { userId: userBId } });
    orgAId = membershipA.organizationId;
    orgBId = membershipB.organizationId;

    return { membershipA, membershipB };
  }

  it("la membresía de cada usuario apunta únicamente a su propia organización", async () => {
    await createTwoIndependentOrganizations();

    const membershipsOfA = await db.membership.findMany({ where: { userId: userAId } });
    const membershipsOfB = await db.membership.findMany({ where: { userId: userBId } });

    expect(membershipsOfA).toHaveLength(1);
    expect(membershipsOfB).toHaveLength(1);
    expect(membershipsOfA[0].organizationId).toBe(orgAId);
    expect(membershipsOfB[0].organizationId).toBe(orgBId);
    // Ningún usuario tiene una fila de membership hacia la organización ajena.
    expect(membershipsOfA.some((m) => m.organizationId === orgBId)).toBe(false);
    expect(membershipsOfB.some((m) => m.organizationId === orgAId)).toBe(false);
  });

  it("los datos de una organización no se filtran al leer la otra por su id", async () => {
    await createTwoIndependentOrganizations();

    const orgA = await getOrganizationWithSyncedStatus(orgAId!);
    const orgB = await getOrganizationWithSyncedStatus(orgBId!);

    expect(orgA?.id).toBe(orgAId);
    expect(orgB?.id).toBe(orgBId);
    expect(orgA?.slug).not.toBe(orgB?.slug);
    expect(orgA?.name).not.toBe(orgB?.name);
  });

  it("eliminar una organización no afecta a la otra (independencia de datos)", async () => {
    await createTwoIndependentOrganizations();

    await db.organization.delete({ where: { id: orgAId! } });
    const removedOrgAId = orgAId;
    orgAId = undefined; // ya se borró, no reintentar en el afterEach

    const stillThere = await db.organization.findUnique({ where: { id: orgBId! } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.id).toBe(orgBId);

    const deletedOne = await db.organization.findUnique({ where: { id: removedOrgAId } });
    expect(deletedOne).toBeNull();
  });

  it("el email de un propietario es único globalmente, pero eso no acopla los datos de las organizaciones", async () => {
    const { membershipA } = await createTwoIndependentOrganizations();
    const ownerA = await db.user.findUniqueOrThrow({ where: { id: membershipA.userId } });

    const duplicate = await registerOrganization({
      businessName: "Intento duplicado",
      name: "Otro nombre",
      email: ownerA.email,
      password: "OtraContrasena123",
    });

    expect(duplicate.success).toBe(false);
  });
});
