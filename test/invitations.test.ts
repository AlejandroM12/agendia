import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import {
  acceptInvitationWithAccount,
  acceptInvitationWithNewAccount,
  createInvitation,
  findInvitationByToken,
  getAccessStates,
  removeAdmin,
  resendInvitation,
  revokeInvitation,
  revokeProfessionalAccess,
} from "@/modules/team/invitations";
import { addProfessional, createSchedulableOrganization, uniqueSuffix } from "./helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
const tenants: Tenant[] = [];
const extraUsers: string[] = [];

/** Negocio listo para invitar: con cuentas individuales habilitadas y dos profesionales. */
async function shop(options: { accounts?: boolean } = {}) {
  const t = await createSchedulableOrganization();
  tenants.push(t);
  await db.organization.update({
    where: { id: t.organization.id },
    data: { onboardingCompletedAt: new Date(), teamModeEnabled: true, teamAccountsEnabled: options.accounts ?? true, extraProfessionals: 4 },
  });
  const professional = await addProfessional(t.organization.id, { displayName: "Martín" });
  const org = () => db.organization.findUniqueOrThrow({ where: { id: t.organization.id } });
  return { t, professional, org, actor: { id: t.userId, name: "Ana Dueña" } };
}
type Shop = Awaited<ReturnType<typeof shop>>;

const email = () => `inv-${uniqueSuffix()}@example.com`;
const tokenOf = (devLink: string | undefined) => devLink!.split("/").pop()!;

async function invite(s: Shop, to = email(), professionalId = s.professional.id) {
  const result = await createInvitation(await s.org(), s.actor, { email: to, role: "professional", professionalId });
  if (!result.ok) throw new Error(result.message);
  return { ...result, token: tokenOf(result.devLink), email: to };
}

async function newUser(address: string, name = "Persona Invitada") {
  const user = await db.user.create({ data: { email: address, name, passwordHash: "x", emailVerifiedAt: new Date() } });
  extraUsers.push(user.id);
  return user;
}

afterAll(async () => {
  for (const t of tenants) await t.cleanup();
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
});

describe("crear, reenviar y revocar invitaciones", () => {
  it("crea una invitación atada a negocio, correo, rol y perfil; solo se guarda el hash del token", async () => {
    const s = await shop();
    const sent = await invite(s);
    const row = await db.invitation.findUniqueOrThrow({ where: { id: sent.invitationId } });
    expect(row).toMatchObject({ organizationId: s.t.organization.id, professionalId: s.professional.id, email: sent.email, role: "professional", status: "pending", sendCount: 1 });
    expect(row.tokenHash).toBe(createHash("sha256").update(sent.token).digest("hex"));
    expect(row.tokenHash).not.toContain(sent.token);
    expect(sent.token.length).toBeGreaterThanOrEqual(40);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.5 * 86_400_000);
    // Ninguna fila (ni la auditoría) guarda el token en claro.
    const audit = await db.auditLog.findMany({ where: { organizationId: s.t.organization.id } });
    expect(JSON.stringify(audit)).not.toContain(sent.token);
    expect(audit.some((a) => a.action === "team.invitation.create")).toBe(true);
  });

  it("normaliza el correo y rechaza los inválidos", async () => {
    const s = await shop();
    const upper = `  ${email().toUpperCase()} `;
    const ok = await createInvitation(await s.org(), s.actor, { email: upper, role: "professional", professionalId: s.professional.id });
    expect(ok.ok).toBe(true);
    expect((await db.invitation.findFirstOrThrow({ where: { organizationId: s.t.organization.id } })).email).toBe(upper.trim().toLowerCase());
    for (const bad of ["", "sin-arroba", "a@b", "a b@c.com", `${"x".repeat(250)}@mail.com`]) {
      expect(await createInvitation(await s.org(), s.actor, { email: bad, role: "professional", professionalId: s.professional.id }), bad).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("no invita sin la función habilitada, en solo lectura, a perfiles ajenos, inactivos o ya vinculados, ni a quien ya es miembro", async () => {
    const off = await shop({ accounts: false });
    expect(await createInvitation(await off.org(), off.actor, { email: email(), role: "professional", professionalId: off.professional.id })).toMatchObject({ ok: false, code: "disabled" });

    const s = await shop();
    const other = await shop();
    expect(await createInvitation(await s.org(), s.actor, { email: email(), role: "professional", professionalId: other.professional.id })).toMatchObject({ ok: false, code: "not_found" });
    expect(await createInvitation(await s.org(), s.actor, { email: email(), role: "professional", professionalId: "no-existe" })).toMatchObject({ ok: false, code: "not_found" });
    expect(await createInvitation(await s.org(), s.actor, { email: email(), role: "professional", professionalId: null })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createInvitation(await s.org(), s.actor, { email: email(), role: "admin", professionalId: s.professional.id })).toMatchObject({ ok: false, code: "invalid" });

    await db.professional.update({ where: { id: s.professional.id }, data: { active: false } });
    expect(await createInvitation(await s.org(), s.actor, { email: email(), role: "professional", professionalId: s.professional.id })).toMatchObject({ ok: false, code: "inactive" });
    await db.professional.update({ where: { id: s.professional.id }, data: { active: true } });

    expect(await createInvitation(await s.org(), s.actor, { email: s.t.ownerEmail, role: "professional", professionalId: s.professional.id })).toMatchObject({ ok: false, code: "already_member" });

    await db.organization.update({ where: { id: s.t.organization.id }, data: { status: "suspended" } });
    expect(await createInvitation(await s.org(), s.actor, { email: email(), role: "professional", professionalId: s.professional.id })).toMatchObject({ ok: false, code: "read_only" });
    await db.organization.update({ where: { id: s.t.organization.id }, data: { status: "trial" } });

    const linked = await invite(s);
    const user = await newUser(linked.email);
    expect((await acceptInvitationWithAccount(linked.token, user)).ok).toBe(true);
    expect(await createInvitation(await s.org(), s.actor, { email: email(), role: "professional", professionalId: s.professional.id })).toMatchObject({ ok: false, code: "already_linked" });
  });

  it("una sola invitación pendiente por perfil: crear otra deja sin efecto la anterior", async () => {
    const s = await shop();
    const first = await invite(s);
    const second = await invite(s);
    expect(await findInvitationByToken(first.token)).toBeNull();
    expect(await findInvitationByToken(second.token)).not.toBeNull();
    expect(await db.invitation.count({ where: { professionalId: s.professional.id, status: "pending" } })).toBe(1);
    // La base lo garantiza aunque el código fallara.
    await expect(
      db.invitation.create({ data: { organizationId: s.t.organization.id, professionalId: s.professional.id, email: email(), role: "professional", tokenHash: `h-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 1e9) } }),
    ).rejects.toThrow();
  });

  it("el mismo correo no puede tener dos invitaciones pendientes de perfiles distintos en el negocio", async () => {
    const s = await shop();
    const second = await addProfessional(s.t.organization.id, { displayName: "Diego" });
    const shared = email();
    await invite(s, shared);
    expect(await createInvitation(await s.org(), s.actor, { email: shared, role: "professional", professionalId: second.id })).toMatchObject({ ok: false, code: "pending_elsewhere" });
  });

  it("reenviar emite un token nuevo (el anterior deja de servir), respeta la espera y el tope de envíos", async () => {
    const s = await shop();
    const sent = await invite(s);
    const org = await s.org();
    expect(await resendInvitation(org, s.actor, sent.invitationId)).toMatchObject({ ok: false, code: "cooldown" });

    await db.invitation.update({ where: { id: sent.invitationId }, data: { lastSentAt: new Date(Date.now() - 120_000) } });
    const again = await resendInvitation(org, s.actor, sent.invitationId);
    expect(again.ok).toBe(true);
    const newToken = tokenOf(again.ok ? again.devLink : undefined);
    expect(newToken).not.toBe(sent.token);
    expect(await findInvitationByToken(sent.token)).toBeNull();
    expect(await findInvitationByToken(newToken)).not.toBeNull();
    expect((await db.invitation.findUniqueOrThrow({ where: { id: sent.invitationId } })).sendCount).toBe(2);

    await db.invitation.update({ where: { id: sent.invitationId }, data: { sendCount: 5, lastSentAt: new Date(Date.now() - 120_000) } });
    expect(await resendInvitation(org, s.actor, sent.invitationId)).toMatchObject({ ok: false, code: "send_limit" });
  });

  it("revocar cancela el enlace; una invitación de otro negocio no se puede revocar ni reenviar", async () => {
    const s = await shop();
    const other = await shop();
    const sent = await invite(s);
    expect(await revokeInvitation(other.t.organization, other.actor, sent.invitationId)).toMatchObject({ ok: false });
    expect(await resendInvitation(await other.org(), other.actor, sent.invitationId)).toMatchObject({ ok: false, code: "not_found" });
    expect(await findInvitationByToken(sent.token)).not.toBeNull();

    expect((await revokeInvitation(s.t.organization, s.actor, sent.invitationId)).ok).toBe(true);
    expect(await findInvitationByToken(sent.token)).toBeNull();
    expect(await revokeInvitation(s.t.organization, s.actor, sent.invitationId)).toMatchObject({ ok: false });
    // Con el perfil libre se puede invitar de nuevo.
    expect((await invite(s)).ok).toBe(true);
  });

  it("limita las invitaciones por correo en un día (para no llenarle la casilla a nadie)", async () => {
    const s = await shop();
    const target = email();
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await createInvitation(await s.org(), s.actor, { email: target, role: "professional", professionalId: s.professional.id }));
    }
    expect(results.slice(0, 3).every((r) => r.ok)).toBe(true);
    expect(results[3]).toMatchObject({ ok: false, code: "rate_limited" });
  });
});

describe("aceptar invitaciones", () => {
  it("con una cuenta existente: crea la membresía de profesional, vincula el perfil y no toca sus otros negocios", async () => {
    const s = await shop();
    const sent = await invite(s);
    const user = await newUser(sent.email);
    const home = await createSchedulableOrganization();
    tenants.push(home);
    await db.membership.create({ data: { organizationId: home.organization.id, userId: user.id, role: "owner" } });

    const accepted = await acceptInvitationWithAccount(sent.token, user);
    expect(accepted).toMatchObject({ ok: true, organizationId: s.t.organization.id, role: "professional" });
    expect(await db.membership.findFirstOrThrow({ where: { organizationId: s.t.organization.id, userId: user.id } })).toMatchObject({ role: "professional", notifyBookings: true });
    expect((await db.professional.findUniqueOrThrow({ where: { id: s.professional.id } })).userId).toBe(user.id);
    expect(await db.membership.count({ where: { userId: user.id } })).toBe(2);
    expect((await db.membership.findFirstOrThrow({ where: { organizationId: home.organization.id, userId: user.id } })).role).toBe("owner");
    // No consume un cupo más: el perfil ya existía y ya contaba.
    expect(await db.professional.count({ where: { organizationId: s.t.organization.id } })).toBe(2);
    expect(await findInvitationByToken(sent.token)).toBeNull();
    expect(await db.auditLog.count({ where: { organizationId: s.t.organization.id, action: "team.invitation.accept" } })).toBe(1);
  });

  it("sin cuenta: crea el usuario verificado, sin negocio propio ni suscripción, y entra a la agenda", async () => {
    const s = await shop();
    const sent = await invite(s);
    const result = await acceptInvitationWithNewAccount(sent.token, { name: "Martín Gómez", password: "ContrasenaSegura123" });
    expect(result).toMatchObject({ ok: true, role: "professional", email: sent.email });
    const user = await db.user.findUniqueOrThrow({ where: { email: sent.email }, include: { memberships: true } });
    extraUsers.push(user.id);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.memberships.map((m) => [m.organizationId, m.role])).toEqual([[s.t.organization.id, "professional"]]);
    expect(user.passwordHash).not.toContain("ContrasenaSegura123");
    expect(await db.subscription.count({ where: { organizationId: { not: s.t.organization.id }, organization: { memberships: { some: { userId: user.id } } } } })).toBe(0);
  });

  it("valida nombre y contraseña, y no crea nada si falla", async () => {
    const s = await shop();
    const sent = await invite(s);
    expect(await acceptInvitationWithNewAccount(sent.token, { name: "M", password: "ContrasenaSegura123" })).toMatchObject({ ok: false, code: "name" });
    expect(await acceptInvitationWithNewAccount(sent.token, { name: "Martín", password: "123" })).toMatchObject({ ok: false, code: "weak_password" });
    expect(await db.user.count({ where: { email: sent.email } })).toBe(0);
    expect(await findInvitationByToken(sent.token)).not.toBeNull();
  });

  it("con una cuenta que ya existe no se crea otra: hay que iniciar sesión", async () => {
    const s = await shop();
    const sent = await invite(s);
    await newUser(sent.email);
    expect(await acceptInvitationWithNewAccount(sent.token, { name: "Otro", password: "ContrasenaSegura123" })).toMatchObject({ ok: false });
    expect((await findInvitationByToken(sent.token))?.view.accountExists).toBe(true);
    expect(await db.user.count({ where: { email: sent.email } })).toBe(1);
  });

  it("rechaza token incorrecto, vencido, reutilizado, revocado o con otro correo", async () => {
    const s = await shop();
    const sent = await invite(s);
    const stranger = await newUser(email());
    const right = await newUser(sent.email);

    for (const bad of ["", "corto", "x".repeat(200), `${sent.token}x`, sent.token.slice(0, -2) + "AA"]) {
      expect(await acceptInvitationWithAccount(bad, right), bad.slice(0, 8)).toMatchObject({ ok: false });
    }
    // Otro correo: nunca se acepta, ni siquiera con el token correcto.
    expect(await acceptInvitationWithAccount(sent.token, stranger)).toMatchObject({ ok: false, code: "email_mismatch" });
    expect(await db.membership.count({ where: { organizationId: s.t.organization.id, userId: stranger.id } })).toBe(0);

    // Vencido.
    await db.invitation.update({ where: { id: sent.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await acceptInvitationWithAccount(sent.token, right)).toMatchObject({ ok: false });
    expect(await findInvitationByToken(sent.token)).toBeNull();
    await db.invitation.update({ where: { id: sent.invitationId }, data: { expiresAt: new Date(Date.now() + 1e9) } });

    // Reutilizado.
    expect((await acceptInvitationWithAccount(sent.token, right)).ok).toBe(true);
    expect(await acceptInvitationWithAccount(sent.token, right)).toMatchObject({ ok: false });

    // Revocado.
    const second = await shop();
    const revoked = await invite(second);
    await revokeInvitation(second.t.organization, second.actor, revoked.invitationId);
    expect(await acceptInvitationWithAccount(revoked.token, await newUser(revoked.email))).toMatchObject({ ok: false });
  });

  it("se vuelve a validar al aceptar: profesional desactivado, perfil ya vinculado, función apagada o negocio suspendido", async () => {
    const inactive = await shop();
    const a = await invite(inactive);
    await db.professional.update({ where: { id: inactive.professional.id }, data: { active: false } });
    expect(await acceptInvitationWithAccount(a.token, await newUser(a.email))).toMatchObject({ ok: false, code: "inactive" });

    const off = await shop();
    const b = await invite(off);
    await db.organization.update({ where: { id: off.t.organization.id }, data: { teamAccountsEnabled: false } });
    expect(await acceptInvitationWithAccount(b.token, await newUser(b.email))).toMatchObject({ ok: false, code: "disabled" });

    const suspended = await shop();
    const c = await invite(suspended);
    await db.organization.update({ where: { id: suspended.t.organization.id }, data: { status: "suspended" } });
    expect(await acceptInvitationWithAccount(c.token, await newUser(c.email))).toMatchObject({ ok: false });

    const taken = await shop();
    const d = await invite(taken);
    const someone = await newUser(email());
    await db.membership.create({ data: { organizationId: taken.t.organization.id, userId: someone.id, role: "professional" } });
    await db.professional.update({ where: { id: taken.professional.id }, data: { userId: someone.id } });
    expect(await acceptInvitationWithAccount(d.token, await newUser(d.email))).toMatchObject({ ok: false, code: "already_linked" });
  });

  it("aceptaciones simultáneas: gana una sola y no queda nada a medias", async () => {
    const s = await shop();
    const sent = await invite(s);
    const users = await Promise.all([newUser(sent.email.replace("@", "+a@")), newUser(sent.email.replace("@", "+b@"))]);
    // Dos personas con el mismo correo no existen: se simula la carrera con la MISMA persona y con otra que no coincide.
    const right = await newUser(sent.email);
    const results = await Promise.all([1, 2, 3, 4].map(() => acceptInvitationWithAccount(sent.token, right)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.membership.count({ where: { organizationId: s.t.organization.id, userId: right.id } })).toBe(1);
    expect(await db.invitation.count({ where: { id: sent.invitationId, status: "accepted" } })).toBe(1);
    expect(users).toHaveLength(2);

    // Dos invitaciones al mismo perfil no pueden quedar activas a la vez: la segunda anula la primera.
    const t2 = await shop();
    const x = await invite(t2);
    const y = await invite(t2);
    const [rx, ry] = await Promise.all([acceptInvitationWithAccount(x.token, await newUser(x.email)), acceptInvitationWithAccount(y.token, await newUser(y.email))]);
    expect([rx.ok, ry.ok].filter(Boolean)).toHaveLength(1);
    expect(await db.membership.count({ where: { organizationId: t2.t.organization.id, role: "professional" } })).toBe(1);
  });
});

describe("estados de acceso y revocación", () => {
  it("muestra sin acceso → pendiente → vencida → vinculada → revocada, y revocar conserva todo el perfil", async () => {
    const s = await shop();
    const state = async () => (await getAccessStates(s.t.organization.id)).get(s.professional.id)!.state;
    expect(await state()).toBe("none");

    const sent = await invite(s);
    expect(await state()).toBe("pending");
    await db.invitation.update({ where: { id: sent.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await state()).toBe("expired");
    await db.invitation.update({ where: { id: sent.invitationId }, data: { expiresAt: new Date(Date.now() + 1e9) } });

    const user = await newUser(sent.email);
    await acceptInvitationWithAccount(sent.token, user);
    expect(await state()).toBe("linked");

    // Datos que deben sobrevivir: turnos, horarios, servicios.
    const hours = await db.availabilityRule.count({ where: { professionalId: s.professional.id } });
    const customer = await db.customer.create({ data: { organizationId: s.t.organization.id, name: "Cliente" } });
    const appointment = await db.appointment.create({
      data: {
        organizationId: s.t.organization.id, professionalId: s.professional.id, serviceId: s.t.service.id, customerId: customer.id,
        startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 86_400_000 + 1_800_000), manageToken: `rev-${uniqueSuffix()}-token-largo`,
      },
    });
    const other = await createSchedulableOrganization();
    tenants.push(other);
    await db.membership.create({ data: { organizationId: other.organization.id, userId: user.id, role: "admin" } });

    const revoked = await revokeProfessionalAccess(s.t.organization, s.actor, s.professional.id);
    expect(revoked).toMatchObject({ ok: true, revokedEmail: sent.email });
    expect(await state()).toBe("revoked");
    expect(await db.membership.count({ where: { organizationId: s.t.organization.id, userId: user.id } })).toBe(0);
    expect(await db.membership.count({ where: { organizationId: other.organization.id, userId: user.id } })).toBe(1); // sus otros negocios no cambian
    expect(await db.user.count({ where: { id: user.id } })).toBe(1);
    expect(await db.professional.count({ where: { id: s.professional.id, active: true } })).toBe(1);
    expect(await db.availabilityRule.count({ where: { professionalId: s.professional.id } })).toBe(hours);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("confirmed");
    expect(await db.auditLog.count({ where: { organizationId: s.t.organization.id, action: "team.access.revoke" } })).toBe(1);

    // Una futura reactivación no devuelve el acceso por sí sola: hay que invitar de nuevo.
    await db.professional.update({ where: { id: s.professional.id }, data: { active: false } });
    await db.professional.update({ where: { id: s.professional.id }, data: { active: true } });
    expect(await state()).toBe("revoked");
    expect(await db.membership.count({ where: { organizationId: s.t.organization.id, userId: user.id } })).toBe(0);
    expect((await invite(s)).ok).toBe(true);
  });

  it("no revoca al propietario ni a un administrador desde acá, ni a un perfil de otro negocio", async () => {
    const s = await shop();
    const other = await shop();
    // El propietario vinculado a su propio perfil («atiendo yo»).
    await db.professional.update({ where: { id: s.professional.id }, data: { userId: s.t.userId } });
    expect(await revokeProfessionalAccess(s.t.organization, s.actor, s.professional.id)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await db.membership.count({ where: { organizationId: s.t.organization.id, userId: s.t.userId, role: "owner" } })).toBe(1);
    expect(await revokeProfessionalAccess(other.t.organization, other.actor, s.professional.id)).toMatchObject({ ok: false });
  });

  it("el propietario puede quitar a un administrador, nunca a sí mismo ni a otro rol", async () => {
    const s = await shop();
    const admin = await newUser(email(), "Admin");
    await db.membership.create({ data: { organizationId: s.t.organization.id, userId: admin.id, role: "admin", notifyBookings: false } });
    expect(await removeAdmin(s.t.organization, s.actor, s.t.userId)).toMatchObject({ ok: false }); // el propietario no se quita
    expect(await removeAdmin(s.t.organization, s.actor, admin.id)).toMatchObject({ ok: true });
    expect(await db.membership.count({ where: { organizationId: s.t.organization.id, userId: admin.id } })).toBe(0);
    expect(await removeAdmin(s.t.organization, s.actor, admin.id)).toMatchObject({ ok: false });
  });

  it("invitar a un administrador: sin perfil, notificaciones apagadas al aceptar, y sin consumir cupo", async () => {
    const s = await shop();
    const to = email();
    const result = await createInvitation(await s.org(), s.actor, { email: to, role: "admin" });
    expect(result.ok).toBe(true);
    const user = await newUser(to);
    const accepted = await acceptInvitationWithAccount(tokenOf(result.ok ? result.devLink : undefined), user);
    expect(accepted).toMatchObject({ ok: true, role: "admin" });
    expect(await db.membership.findFirstOrThrow({ where: { organizationId: s.t.organization.id, userId: user.id } })).toMatchObject({ role: "admin", notifyBookings: false });
    expect(await db.professional.count({ where: { organizationId: s.t.organization.id } })).toBe(2);
  });

  it("la base impide vincular un profesional a alguien que no es miembro de su negocio, o a una misma persona dos veces", async () => {
    const s = await shop();
    const stranger = await newUser(email());
    await expect(db.professional.update({ where: { id: s.professional.id }, data: { userId: stranger.id } })).rejects.toThrow();
    await db.membership.create({ data: { organizationId: s.t.organization.id, userId: stranger.id, role: "professional" } });
    await db.professional.update({ where: { id: s.professional.id }, data: { userId: stranger.id } });
    const second = await addProfessional(s.t.organization.id, { displayName: "Otro" });
    await expect(db.professional.update({ where: { id: second.id }, data: { userId: stranger.id } })).rejects.toThrow();
    // Un rol de invitación nunca puede ser propietario.
    await expect(
      db.invitation.create({ data: { organizationId: s.t.organization.id, email: email(), role: "owner", tokenHash: `h-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 1e9) } }),
    ).rejects.toThrow();
  });
});
