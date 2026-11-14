-- CreateEnum
CREATE TYPE "OrganizationImageKind" AS ENUM ('logo', 'cover');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "showAddress" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showInstagram" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showPhone" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showPrices" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showWhatsapp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "specialty" TEXT,
ADD COLUMN     "themeFont" TEXT NOT NULL DEFAULT 'clasica',
ADD COLUMN     "themePrimary" TEXT NOT NULL DEFAULT '#1f4d3f',
ADD COLUMN     "themeSecondary" TEXT NOT NULL DEFAULT '#c8643c',
ADD COLUMN     "whatsapp" TEXT;

-- CreateTable
CREATE TABLE "organization_slug_aliases" (
    "slug" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_slug_aliases_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "organization_images" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "OrganizationImageKind" NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_access_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_slug_aliases_organizationId_createdAt_idx" ON "organization_slug_aliases"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "organization_images_organizationId_kind_key" ON "organization_images"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "customer_access_tokens_tokenHash_key" ON "customer_access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "customer_access_tokens_organizationId_email_idx" ON "customer_access_tokens"("organizationId", "email");

-- AddForeignKey
ALTER TABLE "organization_slug_aliases" ADD CONSTRAINT "organization_slug_aliases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_images" ADD CONSTRAINT "organization_images_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_access_tokens" ADD CONSTRAINT "customer_access_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
