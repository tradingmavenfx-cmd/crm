-- Row-level security.
--
-- Tenant isolation was enforced only in application code: a query that
-- forgot its tenantId would have been answered in full. These policies move
-- that guarantee into the database, so forgetting is no longer possible.
--
-- app.tenant_id  - the tenant this connection is working as
-- app.bypass_rls - set to "on" for the work that is genuinely cross-tenant:
--                  signing in (the tenant is not known yet), token-addressed
--                  public pages, scheduled sweeps and the seed.
--
-- FORCE is required because the application connects as the table owner,
-- and an owner is otherwise exempt from its own policies.

ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "activities";
CREATE POLICY tenant_isolation ON "activities"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "ai_insights" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_insights" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ai_insights";
CREATE POLICY tenant_isolation ON "ai_insights"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "article_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "article_categories" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "article_categories";
CREATE POLICY tenant_isolation ON "article_categories"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "article_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "article_feedback" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "article_feedback";
CREATE POLICY tenant_isolation ON "article_feedback"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "article_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "article_versions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "article_versions";
CREATE POLICY tenant_isolation ON "article_versions"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "articles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "articles";
CREATE POLICY tenant_isolation ON "articles"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "assignment_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assignment_rules";
CREATE POLICY tenant_isolation ON "assignment_rules"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_logs";
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "badges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "badges" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "badges";
CREATE POLICY tenant_isolation ON "badges"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calls" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "calls";
CREATE POLICY tenant_isolation ON "calls"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_recipients" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "campaign_recipients";
CREATE POLICY tenant_isolation ON "campaign_recipients"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "campaigns";
CREATE POLICY tenant_isolation ON "campaigns"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "canned_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "canned_responses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "canned_responses";
CREATE POLICY tenant_isolation ON "canned_responses"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "chat_visitors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_visitors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "chat_visitors";
CREATE POLICY tenant_isolation ON "chat_visitors"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "companies";
CREATE POLICY tenant_isolation ON "companies"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "contacts";
CREATE POLICY tenant_isolation ON "contacts"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "contests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "contests";
CREATE POLICY tenant_isolation ON "contests"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "conversations";
CREATE POLICY tenant_isolation ON "conversations"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "dashboard_widgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_widgets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dashboard_widgets";
CREATE POLICY tenant_isolation ON "dashboard_widgets"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "dashboards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboards" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dashboards";
CREATE POLICY tenant_isolation ON "dashboards"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "deal_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_stages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "deal_stages";
CREATE POLICY tenant_isolation ON "deal_stages"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "deals";
CREATE POLICY tenant_isolation ON "deals"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "discount_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discount_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "discount_rules";
CREATE POLICY tenant_isolation ON "discount_rules"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "document_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "document_events";
CREATE POLICY tenant_isolation ON "document_events"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "document_folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_folders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "document_folders";
CREATE POLICY tenant_isolation ON "document_folders"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "document_shares" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_shares" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "document_shares";
CREATE POLICY tenant_isolation ON "document_shares"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "document_templates";
CREATE POLICY tenant_isolation ON "document_templates"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "document_versions";
CREATE POLICY tenant_isolation ON "document_versions"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "documents";
CREATE POLICY tenant_isolation ON "documents"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "email_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "email_events";
CREATE POLICY tenant_isolation ON "email_events"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "email_templates";
CREATE POLICY tenant_isolation ON "email_templates"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "forecast_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "forecast_snapshots";
CREATE POLICY tenant_isolation ON "forecast_snapshots"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "form_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_submissions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "form_submissions";
CREATE POLICY tenant_isolation ON "form_submissions"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "invoices";
CREATE POLICY tenant_isolation ON "invoices"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "ivr_flows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ivr_flows" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ivr_flows";
CREATE POLICY tenant_isolation ON "ivr_flows"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "kb_searches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kb_searches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "kb_searches";
CREATE POLICY tenant_isolation ON "kb_searches"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "landing_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "landing_pages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "landing_pages";
CREATE POLICY tenant_isolation ON "landing_pages"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "leads";
CREATE POLICY tenant_isolation ON "leads"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "login_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_attempts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "login_attempts";
CREATE POLICY tenant_isolation ON "login_attempts"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "marketing_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_forms" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "marketing_forms";
CREATE POLICY tenant_isolation ON "marketing_forms"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "mentions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mentions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mentions";
CREATE POLICY tenant_isolation ON "mentions"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "messages";
CREATE POLICY tenant_isolation ON "messages"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "portal_login_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_login_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "portal_login_tokens";
CREATE POLICY tenant_isolation ON "portal_login_tokens"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "portal_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "portal_sessions";
CREATE POLICY tenant_isolation ON "portal_sessions"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "price_book_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_book_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "price_book_entries";
CREATE POLICY tenant_isolation ON "price_book_entries"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "price_books" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_books" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "price_books";
CREATE POLICY tenant_isolation ON "price_books"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "products";
CREATE POLICY tenant_isolation ON "products"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "quotas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotas" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "quotas";
CREATE POLICY tenant_isolation ON "quotas"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "quote_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "quote_lines";
CREATE POLICY tenant_isolation ON "quote_lines"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "quotes";
CREATE POLICY tenant_isolation ON "quotes"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "report_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "report_schedules";
CREATE POLICY tenant_isolation ON "report_schedules"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "sequence_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sequence_enrollments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sequence_enrollments";
CREATE POLICY tenant_isolation ON "sequence_enrollments"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sequences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sequences";
CREATE POLICY tenant_isolation ON "sequences"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "short_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "short_links" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "short_links";
CREATE POLICY tenant_isolation ON "short_links"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "sla_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sla_policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sla_policies";
CREATE POLICY tenant_isolation ON "sla_policies"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "sms_opt_outs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_opt_outs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sms_opt_outs";
CREATE POLICY tenant_isolation ON "sms_opt_outs"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "sms_otps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_otps" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sms_otps";
CREATE POLICY tenant_isolation ON "sms_otps"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "sms_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sms_templates";
CREATE POLICY tenant_isolation ON "sms_templates"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tasks";
CREATE POLICY tenant_isolation ON "tasks"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "tenant_security" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_security" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_security";
CREATE POLICY tenant_isolation ON "tenant_security"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "territories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "territories" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "territories";
CREATE POLICY tenant_isolation ON "territories"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "territory_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "territory_members" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "territory_members";
CREATE POLICY tenant_isolation ON "territory_members"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "ticket_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_comments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ticket_comments";
CREATE POLICY tenant_isolation ON "ticket_comments"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "ticket_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ticket_events";
CREATE POLICY tenant_isolation ON "ticket_events"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "ticket_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ticket_rules";
CREATE POLICY tenant_isolation ON "ticket_rules"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tickets";
CREATE POLICY tenant_isolation ON "tickets"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "touchpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "touchpoints" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "touchpoints";
CREATE POLICY tenant_isolation ON "touchpoints"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "user_badges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_badges" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_badges";
CREATE POLICY tenant_isolation ON "user_badges"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_sessions";
CREATE POLICY tenant_isolation ON "user_sessions"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "users";
CREATE POLICY tenant_isolation ON "users"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_runs";
CREATE POLICY tenant_isolation ON "workflow_runs"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflows" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflows";
CREATE POLICY tenant_isolation ON "workflows"
  USING (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );

-- The workspace row itself: its own id is the tenant.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenants";
CREATE POLICY tenant_isolation ON "tenants"
  USING (
    "id"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  )
  WITH CHECK (
    "id"::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.bypass_rls', TRUE) = 'on'
  );
