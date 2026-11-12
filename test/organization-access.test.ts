import { describe, it, expect, afterEach } from "vitest";
import { OrganizationStatus } from "@prisma/client";
import {
  getEffectiveStatus,
  canPerformWriteActions,
  daysRemainingInTrial,
  getOrganizationWithSyncedStatus,
} from "@/lib/organization-access";
import { db } from "@/lib/db";
import { trialPolicy } from "@/lib/brand";
import { cleanupOrganization, uniqueSuffix } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("getEffectiveStatus — política centralizada de prueba/acceso", () => {
  it("mantiene trial mientras no venció trialEndsAt", () => {
    const status = getEffectiveStatus({
      status: OrganizationStatus.trial,
      trialEndsAt: new Date(Date.now() + DAY_MS),
      readonlyUntil: null,
    });
    expect(status).toBe(OrganizationStatus.trial);
  });

  it("pasa a trial_readonly apenas vence trialEndsAt", () => {
    const status = getEffectiveStatus({
      status: OrganizationStatus.trial,
      trialEndsAt: new Date(Date.now() - 1),
      readonlyUntil: null,
    });
    expect(status).toBe(OrganizationStatus.trial_readonly);
  });

  it(`se mantiene en trial_readonly dentro de los ${trialPolicy.readonlyGraceDays} días de gracia`, () => {
    const status = getEffectiveStatus({
      status: OrganizationStatus.trial_readonly,
      trialEndsAt: new Date(Date.now() - DAY_MS), // venció hace 1 día
      readonlyUntil: null, // se calcula a partir de trialEndsAt
    });
    expect(status).toBe(OrganizationStatus.trial_readonly);
  });

  it(`pasa a locked una vez agotados los ${trialPolicy.readonlyGraceDays} días de solo lectura`, () => {
    const status = getEffectiveStatus({
      status: OrganizationStatus.trial_readonly,
      trialEndsAt: new Date(Date.now() - (trialPolicy.readonlyGraceDays + 1) * DAY_MS),
      readonlyUntil: null,
    });
    expect(status).toBe(OrganizationStatus.locked);
  });

  it("no toca estados gobernados por suscripción (active/past_due/canceled/suspended)", () => {
    for (const status of [
      OrganizationStatus.active,
      OrganizationStatus.past_due,
      OrganizationStatus.canceled,
      OrganizationStatus.suspended,
    ]) {
      expect(
        getEffectiveStatus({ status, trialEndsAt: new Date(0), readonlyUntil: null }),
      ).toBe(status);
    }
  });
});

describe("canPerformWriteActions", () => {
  it("permite escritura en trial y active", () => {
    expect(
      canPerformWriteActions({
        status: OrganizationStatus.trial,
        trialEndsAt: new Date(Date.now() + DAY_MS),
        readonlyUntil: null,
      }),
    ).toBe(true);
    expect(
      canPerformWriteActions({
        status: OrganizationStatus.active,
        trialEndsAt: new Date(0),
        readonlyUntil: null,
      }),
    ).toBe(true);
  });

  it("bloquea escritura en trial_readonly y locked", () => {
    expect(
      canPerformWriteActions({
        status: OrganizationStatus.trial,
        trialEndsAt: new Date(Date.now() - 1),
        readonlyUntil: null,
      }),
    ).toBe(false);
    expect(
      canPerformWriteActions({
        status: OrganizationStatus.locked,
        trialEndsAt: new Date(0),
        readonlyUntil: null,
      }),
    ).toBe(false);
  });
});

describe("daysRemainingInTrial", () => {
  it("redondea hacia arriba los días restantes", () => {
    const days = daysRemainingInTrial({
      status: OrganizationStatus.trial,
      trialEndsAt: new Date(Date.now() + 2.2 * DAY_MS),
    });
    expect(days).toBe(3);
  });

  it("devuelve 0 si ya no está en trial", () => {
    const days = daysRemainingInTrial({
      status: OrganizationStatus.active,
      trialEndsAt: new Date(Date.now() + DAY_MS),
    });
    expect(days).toBe(0);
  });
});

describe("getOrganizationWithSyncedStatus — escritura perezosa (DB)", () => {
  let organizationId: string | undefined;

  afterEach(async () => {
    await cleanupOrganization(organizationId);
    organizationId = undefined;
  });

  it("sincroniza status=trial_readonly en la fila cuando el trial ya venció", async () => {
    const created = await db.organization.create({
      data: {
        name: `Test Org ${uniqueSuffix()}`,
        slug: `test-org-${uniqueSuffix()}`,
        status: OrganizationStatus.trial,
        trialStartedAt: new Date(Date.now() - 8 * DAY_MS),
        trialEndsAt: new Date(Date.now() - DAY_MS), // venció ayer
      },
    });
    organizationId = created.id;

    const synced = await getOrganizationWithSyncedStatus(created.id);

    expect(synced?.status).toBe(OrganizationStatus.trial_readonly);
    expect(synced?.readonlyUntil).not.toBeNull();

    // Confirma que quedó persistido, no solo devuelto en memoria.
    const reloaded = await db.organization.findUnique({ where: { id: created.id } });
    expect(reloaded?.status).toBe(OrganizationStatus.trial_readonly);
  });

  it("no modifica una organización cuyo estado efectivo ya coincide con el persistido", async () => {
    const created = await db.organization.create({
      data: {
        name: `Test Org ${uniqueSuffix()}`,
        slug: `test-org-${uniqueSuffix()}`,
        status: OrganizationStatus.trial,
        trialEndsAt: new Date(Date.now() + DAY_MS),
      },
    });
    organizationId = created.id;

    const before = created.updatedAt.getTime();
    const synced = await getOrganizationWithSyncedStatus(created.id);

    expect(synced?.status).toBe(OrganizationStatus.trial);
    expect(synced?.updatedAt.getTime()).toBe(before);
  });
});
