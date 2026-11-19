-- WhatsApp automático (Meta Cloud API): conexión por negocio, consentimiento e historial. Aditiva.

CREATE TABLE "whatsapp_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'not_validated',
    "statusDetail" TEXT,
    "validatedAt" TIMESTAMP(3),
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "displayPhone" TEXT,
    "verifiedName" TEXT,
    "qualityRating" TEXT,
    "credentials" TEXT,
    "credentialsHint" TEXT,
    "verifyTokenHash" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'es_AR',
    "templatesStatus" JSONB,
    "sendConfirmations" BOOLEAN NOT NULL DEFAULT true,
    "sendReminders" BOOLEAN NOT NULL DEFAULT true,
    "reminderHoursBefore" INTEGER NOT NULL DEFAULT 24,
    "sendCancellations" BOOLEAN NOT NULL DEFAULT true,
    "sendReschedules" BOOLEAN NOT NULL DEFAULT true,
    "monthlyLimit" INTEGER NOT NULL DEFAULT 300,
    "testRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_consents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'granted',
    "source" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_consents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "notificationId" TEXT,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "phone" TEXT,
    "bsuid" TEXT,
    "templateName" TEXT,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_connections_organizationId_key" ON "whatsapp_connections"("organizationId");
CREATE UNIQUE INDEX "whatsapp_connections_phoneNumberId_key" ON "whatsapp_connections"("phoneNumberId");
CREATE UNIQUE INDEX "whatsapp_connections_verifyTokenHash_key" ON "whatsapp_connections"("verifyTokenHash");
CREATE UNIQUE INDEX "whatsapp_consents_organizationId_phone_key" ON "whatsapp_consents"("organizationId", "phone");
CREATE UNIQUE INDEX "whatsapp_messages_notificationId_key" ON "whatsapp_messages"("notificationId");
CREATE UNIQUE INDEX "whatsapp_messages_organizationId_providerMessageId_key" ON "whatsapp_messages"("organizationId", "providerMessageId");
CREATE INDEX "whatsapp_messages_organizationId_createdAt_idx" ON "whatsapp_messages"("organizationId", "createdAt");
CREATE INDEX "whatsapp_messages_organizationId_direction_createdAt_idx" ON "whatsapp_messages"("organizationId", "direction", "createdAt");

ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_consents" ADD CONSTRAINT "whatsapp_consents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
