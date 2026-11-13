import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { registerOrganization } from "@/modules/organizations/register";
import {
  isEmailVerificationRequired,
  issueEmailVerification,
  verifyEmailToken,
} from "@/modules/auth/email-verification";
import { requestPasswordReset, resetPassword } from "@/modules/auth/password-reset";
import { cleanupOrganization, cleanupUser, uniqueSuffix } from "./helpers";

describe("verificación de email", () => {
  const created: Array<{ userId: string; organizationId: string }> = [];

  async function createAccount(options: { emailVerified?: boolean } = {}) {
    const suffix = uniqueSuffix();
    const result = await registerOrganization({
      name: "Vera Verifica",
      email: `verify-${suffix}@example.com`,
      password: "Contrasena123",
      ...options,
    });
    if (!result.success) throw new Error("No se pudo crear la cuenta de prueba");
    const membership = await db.membership.findFirstOrThrow({ where: { userId: result.userId } });
    created.push({ userId: result.userId, organizationId: membership.organizationId });
    return { id: result.userId, email: result.email, name: result.name };
  }

  const verifiedAt = async (userId: string) =>
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt;

  const tokenOf = (link: string | undefined) => link?.split("/").pop() ?? "";

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const { userId, organizationId } of created.splice(0)) {
      await cleanupUser(userId);
      await cleanupOrganization(organizationId);
    }
  });

  it("una cuenta nueva nace sin verificar, salvo que se indique lo contrario", async () => {
    expect(await verifiedAt((await createAccount()).id)).toBeNull();
    expect(await verifiedAt((await createAccount({ emailVerified: true })).id)).toBeInstanceOf(Date);
  });

  it("solo se exige verificar cuando hay un canal para enviar el enlace", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(isEmailVerificationRequired()).toBe(false);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Agendia <turnos@example.com>");
    expect(isEmailVerificationRequired()).toBe(true);
  });

  it("el enlace verifica la cuenta y sirve una sola vez", async () => {
    const user = await createAccount();
    const token = tokenOf((await issueEmailVerification(user)).devVerificationLink);
    expect(token).toBeTruthy();

    expect(await verifyEmailToken(token)).toEqual({ ok: true, userId: user.id });
    expect(await verifiedAt(user.id)).toBeInstanceOf(Date);
    expect(await verifyEmailToken(token)).toEqual({ ok: false });
  });

  it("pedir un enlace nuevo invalida el anterior", async () => {
    const user = await createAccount();
    const first = tokenOf((await issueEmailVerification(user)).devVerificationLink);
    const second = tokenOf((await issueEmailVerification(user)).devVerificationLink);

    expect(await verifyEmailToken(first)).toEqual({ ok: false });
    expect(await verifiedAt(user.id)).toBeNull();
    expect((await verifyEmailToken(second)).ok).toBe(true);
  });

  it("rechaza enlaces vencidos, inexistentes o malformados", async () => {
    const user = await createAccount();
    const token = tokenOf((await issueEmailVerification(user)).devVerificationLink);
    await db.emailVerificationToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await verifyEmailToken(token)).toEqual({ ok: false });
    expect(await verifyEmailToken("no-existe")).toEqual({ ok: false });
    expect(await verifyEmailToken("")).toEqual({ ok: false });
    expect(await verifiedAt(user.id)).toBeNull();
  });

  it("con el canal configurado, el enlace viaja por email y no se devuelve a quien lo pide", async () => {
    const user = await createAccount();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Agendia <turnos@example.com>");
    const fetchSpy = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await issueEmailVerification(user);

    expect(result).toEqual({ sent: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init?.body));
    expect(body.to).toEqual([user.email]);
    expect(body.text).toMatch(/\/verificar-email\/[\w-]{20,}/);
  });

  it("si el envío falla, lo informa en lugar de darlo por enviado", async () => {
    const user = await createAccount();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Agendia <turnos@example.com>");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("domain not verified", { status: 403 })));
    const silenced = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await issueEmailVerification(user)).toEqual({ sent: false });
    silenced.mockRestore();
  });

  it("restablecer la contraseña desde el email también confirma la casilla", async () => {
    const user = await createAccount();
    const requested = await requestPasswordReset({ email: user.email });
    const token = tokenOf("devResetLink" in requested ? requested.devResetLink : undefined);

    expect((await resetPassword({ token, password: "OtraContrasena456" })).success).toBe(true);
    expect(await verifiedAt(user.id)).toBeInstanceOf(Date);
  });
});
