-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productName" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#4f46e5',
    "loginHeadline" TEXT,
    "loginSubtext" TEXT,
    "supportEmail" TEXT,
    "customDomain" TEXT,
    "showPoweredBy" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "gstin" TEXT,
    "upiVpa" TEXT,
    "upiName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenantId_key" ON "tenant_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_customDomain_key" ON "tenant_settings"("customDomain");

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, the same policy every other tenant-scoped table has.

ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_settings";
CREATE POLICY tenant_isolation ON "tenant_settings"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );
