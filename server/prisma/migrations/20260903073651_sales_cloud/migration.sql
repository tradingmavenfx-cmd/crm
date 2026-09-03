-- CreateEnum
CREATE TYPE "QuotaPeriod" AS ENUM ('MONTH', 'QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "ForecastCategory" AS ENUM ('OMITTED', 'PIPELINE', 'BEST_CASE', 'COMMIT', 'CLOSED');

-- CreateEnum
CREATE TYPE "ContestMetric" AS ENUM ('REVENUE_WON', 'DEALS_WON', 'CALLS_MADE', 'MEETINGS_HELD', 'TICKETS_RESOLVED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "territoryId" TEXT;

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "forecastCategory" "ForecastCategory";

-- CreateTable
CREATE TABLE "territories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "managerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territory_members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "territory_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT,
    "territoryId" TEXT,
    "period" "QuotaPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT,
    "territoryId" TEXT,
    "period" "QuotaPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed" DECIMAL(18,2) NOT NULL,
    "commit" DECIMAL(18,2) NOT NULL,
    "bestCase" DECIMAL(18,2) NOT NULL,
    "pipeline" DECIMAL(18,2) NOT NULL,
    "weighted" DECIMAL(18,2) NOT NULL,
    "quota" DECIMAL(18,2) NOT NULL,
    "actual" DECIMAL(18,2),

    CONSTRAINT "forecast_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" "ContestMetric" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "prize" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'star',
    "metric" "ContestMetric" NOT NULL,
    "threshold" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "territories_tenantId_parentId_idx" ON "territories"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "territories_tenantId_name_key" ON "territories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "territory_members_tenantId_userId_idx" ON "territory_members"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "territory_members_territoryId_userId_key" ON "territory_members"("territoryId", "userId");

-- CreateIndex
CREATE INDEX "quotas_tenantId_periodStart_idx" ON "quotas"("tenantId", "periodStart");

-- CreateIndex
CREATE INDEX "forecast_snapshots_tenantId_periodStart_idx" ON "forecast_snapshots"("tenantId", "periodStart");

-- CreateIndex
CREATE INDEX "forecast_snapshots_tenantId_ownerId_periodStart_idx" ON "forecast_snapshots"("tenantId", "ownerId", "periodStart");

-- CreateIndex
CREATE INDEX "contests_tenantId_startsAt_idx" ON "contests"("tenantId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "badges_tenantId_key_key" ON "badges"("tenantId", "key");

-- CreateIndex
CREATE INDEX "user_badges_tenantId_userId_idx" ON "user_badges"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_badgeId_key" ON "user_badges"("userId", "badgeId");

-- CreateIndex
CREATE INDEX "companies_tenantId_territoryId_idx" ON "companies"("tenantId", "territoryId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_members" ADD CONSTRAINT "territory_members_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_members" ADD CONSTRAINT "territory_members_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_members" ADD CONSTRAINT "territory_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotas" ADD CONSTRAINT "quotas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotas" ADD CONSTRAINT "quotas_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotas" ADD CONSTRAINT "quotas_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badges" ADD CONSTRAINT "badges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
