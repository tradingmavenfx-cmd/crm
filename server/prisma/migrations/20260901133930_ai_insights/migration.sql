-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('LEAD_SCORE', 'DEAL_RISK', 'NEXT_ACTION', 'SENTIMENT');

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "InsightType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "label" TEXT,
    "summary" TEXT NOT NULL,
    "factors" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_insights_tenantId_entityType_entityId_type_idx" ON "ai_insights"("tenantId", "entityType", "entityId", "type");

-- CreateIndex
CREATE INDEX "ai_insights_tenantId_type_createdAt_idx" ON "ai_insights"("tenantId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
