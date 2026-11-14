-- Etapa 4: cuentas individuales, invitaciones y varias organizaciones por usuario.
-- Cambios aditivos; los datos existentes no se modifican.
--
-- 0. Guardas: aborta (sin cambiar nada) si algún profesional apunta a una cuenta que
--    no es miembro de su negocio (no debería existir: la aplicación lo exigía).
-- 1. Estructura (generada por Prisma): valor `professional` del rol, columnas nuevas,
--    tabla `invitations`, y la unicidad de la cuenta de un profesional pasa de
--    «global» a «por negocio» (una persona puede ser profesional en varios negocios).
-- 2. Integridad en la base: un profesional solo se vincula a un miembro de SU negocio
--    (trigger) y, si esa persona pierde la membresía, se desvincula solo; una sola
--    invitación pendiente por profesional y por correo (índices parciales); rol y
--    profesional de la invitación coherentes (CHECK).

DO $$
DECLARE broken integer;
BEGIN
  SELECT count(*) INTO broken FROM "professionals" p
   WHERE p."userId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "memberships" m WHERE m."organizationId" = p."organizationId" AND m."userId" = p."userId");
  IF broken > 0 THEN
    RAISE EXCEPTION 'Hay % profesional(es) vinculados a una cuenta que no es miembro de su negocio: corregirlo antes de migrar.', broken;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked');
-- AlterEnum
ALTER TYPE "MembershipRole" ADD VALUE 'professional';
-- DropIndex
DROP INDEX "professionals_userId_key";
-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "notifyBookings" BOOLEAN NOT NULL DEFAULT true;
-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "professionalPermissions" JSONB,
ADD COLUMN     "teamAccountsEnabled" BOOLEAN NOT NULL DEFAULT false;
-- AlterTable
ALTER TABLE "professionals" ADD COLUMN     "accessRevokedAt" TIMESTAMP(3),
ADD COLUMN     "permissionOverrides" JSONB;
-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "professionalId" TEXT,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");
-- CreateIndex
CREATE INDEX "invitations_organizationId_status_idx" ON "invitations"("organizationId", "status");
-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");
-- CreateIndex
CREATE UNIQUE INDEX "professionals_organizationId_userId_key" ON "professionals"("organizationId", "userId");
-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_professionalId_fkey" FOREIGN KEY ("organizationId", "professionalId") REFERENCES "professionals"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Integridad
-- ---------------------------------------------------------------------------

CREATE FUNCTION professionals_require_membership() RETURNS trigger AS $$
BEGIN
  IF NEW."userId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "memberships" m WHERE m."organizationId" = NEW."organizationId" AND m."userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'Un profesional solo puede vincularse a un miembro de su negocio' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER professionals_require_membership
  BEFORE INSERT OR UPDATE OF "userId", "organizationId" ON "professionals"
  FOR EACH ROW EXECUTE FUNCTION professionals_require_membership();

-- Al perder la membresía, el profesional queda sin cuenta (el perfil, la agenda y el historial siguen).
CREATE FUNCTION memberships_release_professional() RETURNS trigger AS $$
BEGIN
  UPDATE "professionals" SET "userId" = NULL
   WHERE "organizationId" = OLD."organizationId" AND "userId" = OLD."userId";
  RETURN OLD;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER memberships_release_professional
  AFTER DELETE ON "memberships"
  FOR EACH ROW EXECUTE FUNCTION memberships_release_professional();

CREATE UNIQUE INDEX "invitations_one_pending_per_professional"
  ON "invitations" ("professionalId") WHERE "status" = 'pending' AND "professionalId" IS NOT NULL;
CREATE UNIQUE INDEX "invitations_one_pending_per_email"
  ON "invitations" ("organizationId", "email") WHERE "status" = 'pending';

-- Un profesional se invita con su perfil; un administrador, sin perfil; nunca un propietario.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_professional_check"
  CHECK ((("role"::text = 'professional') = ("professionalId" IS NOT NULL)) AND "role"::text <> 'owner');
