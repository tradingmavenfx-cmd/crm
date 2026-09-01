-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'BUSY', 'FAILED', 'VOICEMAIL');

-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'VOICE';

-- CreateTable
CREATE TABLE "ivr_flows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "greeting" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ivr_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "direction" "CallDirection" NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'QUEUED',
    "externalId" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "recordingUrl" TEXT,
    "transcript" TEXT,
    "ivrPath" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactId" TEXT,
    "agentId" TEXT,
    "ivrFlowId" TEXT,
    "conversationId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_opt_outs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'stop_keyword',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_otps" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ivr_flows_tenantId_idx" ON "ivr_flows"("tenantId");

-- CreateIndex
CREATE INDEX "ivr_flows_tenantId_isActive_idx" ON "ivr_flows"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "calls_tenantId_startedAt_idx" ON "calls"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "calls_tenantId_agentId_idx" ON "calls"("tenantId", "agentId");

-- CreateIndex
CREATE INDEX "calls_tenantId_status_idx" ON "calls"("tenantId", "status");

-- CreateIndex
CREATE INDEX "calls_externalId_idx" ON "calls"("externalId");

-- CreateIndex
CREATE INDEX "sms_templates_tenantId_idx" ON "sms_templates"("tenantId");

-- CreateIndex
CREATE INDEX "sms_opt_outs_tenantId_idx" ON "sms_opt_outs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "sms_opt_outs_tenantId_phone_key" ON "sms_opt_outs"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "sms_otps_tenantId_phone_idx" ON "sms_otps"("tenantId", "phone");

-- AddForeignKey
ALTER TABLE "ivr_flows" ADD CONSTRAINT "ivr_flows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_ivrFlowId_fkey" FOREIGN KEY ("ivrFlowId") REFERENCES "ivr_flows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_opt_outs" ADD CONSTRAINT "sms_opt_outs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_otps" ADD CONSTRAINT "sms_otps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
