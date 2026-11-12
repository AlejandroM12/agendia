import { describe, it, expect, afterEach } from "vitest";
import { registerOrganization } from "@/modules/organizations/register";
import { requestPasswordReset, resetPassword } from "@/modules/auth/password-reset";
import { verifyPassword } from "@/lib/password";
import { db } from "@/lib/db";
import { cleanupOrganization, cleanupUser, uniqueSuffix } from "./helpers";

async function createTestUser() {
  const suffix = uniqueSuffix();
  const email = `reset-${suffix}@example.com`;
  const result = await registerOrganization({
    businessName: `Reset Test ${suffix}`,
    name: "Reset Owner",
    email,
    password: "ContrasenaOriginal123",
  });
  if (!result.success) throw new Error("No se pudo crear el usuario de prueba");
  const membership = await db.membership.findFirstOrThrow({ where: { userId: result.userId } });
  return { userId: result.userId, organizationId: membership.organizationId, email };
}

describe("recuperación de contraseña", () => {
  let userId: string | undefined;
  let organizationId: string | undefined;

  afterEach(async () => {
    await cleanupUser(userId);
    await cleanupOrganization(organizationId);
    userId = undefined;
    organizationId = undefined;
  });

  it("genera un enlace de reseteo (placeholder de dev) solo si el email existe", async () => {
    const user = await createTestUser();
    userId = user.userId;
    organizationId = user.organizationId;

    const result = await requestPasswordReset({ email: user.email });

    expect(result.requested).toBe(true);
    expect("devResetLink" in result && result.devResetLink).toBeTruthy();
  });

  it("no revela si un email NO existe (misma respuesta, sin enlace)", async () => {
    const result = await requestPasswordReset({ email: "no-existe-ninguna-cuenta@example.com" });

    expect(result.requested).toBe(true);
    expect("devResetLink" in result ? result.devResetLink : undefined).toBeUndefined();
  });

  it("el envío real por email sigue sin implementarse: el link se devuelve en texto plano, no por email", async () => {
    const user = await createTestUser();
    userId = user.userId;
    organizationId = user.organizationId;

    const result = await requestPasswordReset({ email: user.email });

    // Este test documenta el placeholder explícito (Fase 4 / Resend).
    // Si algún día esto deja de devolver el link porque ya se envía por
    // email de verdad, hay que actualizar también la UI de
    // olvide-contrasena (components/auth/forgot-password-form.tsx) y el
    // aviso correspondiente en docs/DECISIONS.md.
    expect("devResetLink" in result && result.devResetLink).toMatch(
      /^\/restablecer-contrasena\//,
    );
  });

  it("permite restablecer la contraseña con un token válido", async () => {
    const user = await createTestUser();
    userId = user.userId;
    organizationId = user.organizationId;

    const requested = await requestPasswordReset({ email: user.email });
    const link = "devResetLink" in requested ? requested.devResetLink : undefined;
    const token = link?.split("/").pop();
    expect(token).toBeTruthy();

    const result = await resetPassword({ token, password: "ContrasenaNueva456" });
    expect(result.success).toBe(true);

    const updatedUser = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(await verifyPassword("ContrasenaNueva456", updatedUser.passwordHash)).toBe(true);
    expect(await verifyPassword("ContrasenaOriginal123", updatedUser.passwordHash)).toBe(false);
  });

  it("rechaza reutilizar un token ya usado", async () => {
    const user = await createTestUser();
    userId = user.userId;
    organizationId = user.organizationId;

    const requested = await requestPasswordReset({ email: user.email });
    const link = "devResetLink" in requested ? requested.devResetLink : undefined;
    const token = link?.split("/").pop();

    const firstAttempt = await resetPassword({ token, password: "PrimeraNueva123" });
    expect(firstAttempt.success).toBe(true);

    const secondAttempt = await resetPassword({ token, password: "SegundaNueva123" });
    expect(secondAttempt.success).toBe(false);
  });

  it("rechaza un token inexistente o malformado", async () => {
    const result = await resetPassword({ token: "token-que-no-existe", password: "Cualquiera123" });
    expect(result.success).toBe(false);
  });
});
