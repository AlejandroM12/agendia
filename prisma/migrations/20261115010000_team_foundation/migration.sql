-- Equipos con varios profesionales — etapa 1 (docs/MULTI_PROFESSIONAL.md).
--
-- Migración ADITIVA y atómica: solo agrega columnas con valores por defecto,
-- tablas nuevas y restricciones. No borra ni reescribe turnos, clientes,
-- servicios, bloqueos ni configuración. Lo único que modifica es el campo
-- nuevo `professionalId` de los horarios, que se rellena con el profesional
-- original de cada negocio.
--
-- Si alguna comprobación falla, la migración entera se revierte y la base
-- queda como estaba. Orden: (0) guardas → (1) estructura → (2) relleno →
-- (3) claves foráneas → (4) trigger de compatibilidad → (5) verificación.

-- ---------------------------------------------------------------------------
-- 0. Guardas y diagnóstico. No se asume que los datos son perfectos.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  crossed integer;
  without_professional integer;
  several integer;
BEGIN
  -- Turnos cuyo profesional pertenece a otra organización: la clave foránea
  -- compuesta nueva no se podría crear. Debe resolverse a mano antes.
  SELECT count(*) INTO crossed
  FROM "appointments" a JOIN "professionals" p ON p."id" = a."professionalId"
  WHERE p."organizationId" <> a."organizationId";
  IF crossed > 0 THEN
    RAISE EXCEPTION 'team_foundation: % turnos apuntan a un profesional de otra organización. Revisar antes de migrar.', crossed;
  END IF;

  -- Informativo: organizaciones sin profesional (se les crea uno, como hacía
  -- la app al recibir el primer turno) y con más de uno (caso no esperado:
  -- sus horarios se asignan al más antiguo, el que usaba la app).
  SELECT count(*) INTO without_professional
  FROM "organizations" o WHERE NOT EXISTS (SELECT 1 FROM "professionals" p WHERE p."organizationId" = o."id");
  SELECT count(*) INTO several FROM (
    SELECT "organizationId" FROM "professionals" GROUP BY "organizationId" HAVING count(*) > 1
  ) t;
  RAISE NOTICE 'team_foundation: % organizaciones sin profesional (se crea uno), % con más de un profesional (horarios al más antiguo)', without_professional, several;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Estructura
-- ---------------------------------------------------------------------------
-- CreateEnum
CREATE TYPE "ProfessionalSelection" AS ENUM ('specific', 'any');

-- DropForeignKey (se reemplaza por una clave compuesta que además valida la organización)
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_professionalId_fkey";

-- DropIndex
DROP INDEX "professionals_organizationId_idx";

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "professionalSelection" "ProfessionalSelection" NOT NULL DEFAULT 'specific',
ADD COLUMN     "requestedProfessionalId" TEXT;

-- AlterTable
ALTER TABLE "availability_exceptions" ADD COLUMN     "professionalId" TEXT;

-- AlterTable
ALTER TABLE "availability_rules" ADD COLUMN     "professionalId" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "extraProfessionals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "teamModeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "professionals" ADD COLUMN     "bookableOnline" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#1f4d3f',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "photoImageId" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "allProfessionals" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "service_professionals" (
    "organizationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_professionals_pkey" PRIMARY KEY ("serviceId","professionalId")
);

-- CreateIndex
CREATE INDEX "service_professionals_professionalId_idx" ON "service_professionals"("professionalId");

-- CreateIndex
CREATE INDEX "appointments_professionalId_startsAt_idx" ON "appointments"("professionalId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_organizationId_idempotencyKey_key" ON "appointments"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "availability_exceptions_professionalId_date_idx" ON "availability_exceptions"("professionalId", "date");

-- CreateIndex
CREATE INDEX "availability_rules_professionalId_weekday_idx" ON "availability_rules"("professionalId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "professionals_userId_key" ON "professionals"("userId");

-- CreateIndex
CREATE INDEX "professionals_organizationId_active_sortOrder_idx" ON "professionals"("organizationId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "professionals_organizationId_id_key" ON "professionals"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "services_organizationId_id_key" ON "services"("organizationId", "id");

-- ---------------------------------------------------------------------------
-- 2. Relleno de datos
-- ---------------------------------------------------------------------------
-- 2.1 Organizaciones sin profesional: uno, con el nombre del negocio (es lo
--     que habría creado la app al recibir el primer turno).
INSERT INTO "professionals" ("id", "organizationId", "displayName", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", o."name", true, now(), now()
FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "professionals" p WHERE p."organizationId" = o."id");

-- 2.2 Orden de visualización: el orden de alta, por organización.
UPDATE "professionals" p
SET "sortOrder" = r."position"
FROM (
  SELECT "id", (row_number() OVER (PARTITION BY "organizationId" ORDER BY "createdAt" ASC, "id" ASC) - 1) AS "position"
  FROM "professionals"
) r
WHERE p."id" = r."id";

-- 2.3 Horarios: pertenecen al profesional original de cada negocio, el mismo
--     que usaba la app para sus turnos (el activo más antiguo; si no hay
--     activos, el más antiguo). Los bloqueos quedan SIN profesional: son
--     generales, igual que antes.
UPDATE "availability_rules" r
SET "professionalId" = (
  SELECT p."id" FROM "professionals" p
  WHERE p."organizationId" = r."organizationId"
  ORDER BY p."active" DESC, p."createdAt" ASC, p."id" ASC
  LIMIT 1
)
WHERE r."professionalId" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Claves foráneas (después del relleno)
-- ---------------------------------------------------------------------------
-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_photoImageId_fkey" FOREIGN KEY ("photoImageId") REFERENCES "organization_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professionals_organizationId_serviceId_fkey" FOREIGN KEY ("organizationId", "serviceId") REFERENCES "services"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professionals_organizationId_professionalId_fkey" FOREIGN KEY ("organizationId", "professionalId") REFERENCES "professionals"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_organizationId_professionalId_fkey" FOREIGN KEY ("organizationId", "professionalId") REFERENCES "professionals"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_organizationId_professionalId_fkey" FOREIGN KEY ("organizationId", "professionalId") REFERENCES "professionals"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organizationId_professionalId_fkey" FOREIGN KEY ("organizationId", "professionalId") REFERENCES "professionals"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organizationId_requestedProfessionalId_fkey" FOREIGN KEY ("organizationId", "requestedProfessionalId") REFERENCES "professionals"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Compatibilidad con la versión anterior de la aplicación
-- ---------------------------------------------------------------------------
-- La versión anterior inserta horarios sin `professionalId`. Mientras esa
-- versión pueda volver a desplegarse (rollback), la base completa el campo
-- con el profesional original del negocio, igual que el relleno de 2.3.
-- La versión nueva siempre lo informa explícitamente. Este trigger y la
-- columna opcional se retiran en la migración de cierre (ver
-- docs/MULTI_PROFESSIONAL.md §7), cuando el rollback deje de ser necesario.
CREATE FUNCTION "availability_rules_default_professional"() RETURNS trigger AS $$
BEGIN
  IF NEW."professionalId" IS NULL THEN
    SELECT p."id" INTO NEW."professionalId"
    FROM "professionals" p
    WHERE p."organizationId" = NEW."organizationId"
    ORDER BY p."active" DESC, p."sortOrder" ASC, p."createdAt" ASC, p."id" ASC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "availability_rules_default_professional"
  BEFORE INSERT ON "availability_rules"
  FOR EACH ROW EXECUTE FUNCTION "availability_rules_default_professional"();

-- ---------------------------------------------------------------------------
-- 5. Verificación: si algo quedó sin relacionar, se revierte todo.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  unassigned integer;
  empty_orgs integer;
BEGIN
  SELECT count(*) INTO unassigned FROM "availability_rules" WHERE "professionalId" IS NULL;
  IF unassigned > 0 THEN
    RAISE EXCEPTION 'team_foundation: % horarios quedaron sin profesional', unassigned;
  END IF;
  SELECT count(*) INTO empty_orgs
  FROM "organizations" o WHERE NOT EXISTS (SELECT 1 FROM "professionals" p WHERE p."organizationId" = o."id");
  IF empty_orgs > 0 THEN
    RAISE EXCEPTION 'team_foundation: % organizaciones quedaron sin profesional', empty_orgs;
  END IF;
END $$;
