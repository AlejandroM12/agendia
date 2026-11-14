-- Fotos de profesionales (etapa 2 de equipos). Cambio aditivo:
--  * un valor nuevo del enum (las filas existentes no cambian);
--  * la unicidad (organizationId, kind) pasa a valer solo para logo y portada,
--    así un negocio puede tener una foto por profesional sin tocar las demás.
-- Los logos y portadas ya cargados siguen siendo únicos por negocio.

ALTER TYPE "OrganizationImageKind" ADD VALUE IF NOT EXISTS 'professional';

DROP INDEX IF EXISTS "organization_images_organizationId_kind_key";

-- El valor nuevo del enum no se puede usar en esta misma transacción, así que
-- el predicado nombra los tipos que sí son únicos (logo y portada).
CREATE UNIQUE INDEX "organization_images_org_kind_unique"
  ON "organization_images" ("organizationId", "kind")
  WHERE "kind" IN ('logo', 'cover');

CREATE INDEX "organization_images_organizationId_kind_idx"
  ON "organization_images" ("organizationId", "kind");
