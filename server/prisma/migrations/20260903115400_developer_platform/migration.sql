-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "lastDeliveryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_idx" ON "api_keys"("tenantId");

-- CreateIndex
CREATE INDEX "webhooks_tenantId_isActive_idx" ON "webhooks"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenantId_webhookId_createdAt_idx" ON "webhook_deliveries"("tenantId", "webhookId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, the same policy every other tenant-scoped table has.

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "api_keys";
CREATE POLICY tenant_isolation ON "api_keys"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhooks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "webhooks";
CREATE POLICY tenant_isolation ON "webhooks"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "webhook_deliveries";
CREATE POLICY tenant_isolation ON "webhook_deliveries"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );
