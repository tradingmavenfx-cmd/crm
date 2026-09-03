export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; pages: number };
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyId: string | null;
  score: number;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  website: string | null;
  employees: number | null;
  createdAt: string;
}

export interface DealStage {
  id: string;
  name: string;
  order: number;
  probability: number;
}

export interface Deal {
  id: string;
  title: string;
  value: string;
  currency: string;
  stageId: string;
  status: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  priority: string;
  status: string;
  createdAt: string;
}

export interface ConversationContact {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Conversation {
  id: string;
  channel: string;
  externalId: string;
  contactId: string | null;
  assignedToId: string | null;
  status: string;
  lastMessageAt: string;
  contact?: ConversationContact | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
}

export interface Message {
  id: string;
  conversationId: string;
  channel: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  subject: string | null;
  body: string | null;
  status: string;
  isInternal: boolean;
  /** Channel-specific detail - call duration, recording URL, IVR keys pressed */
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface TenantUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

export interface CannedResponse {
  id: string;
  title: string;
  body: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export interface SmsTemplate {
  id: string;
  name: string;
  body: string;
}

export interface SmsOptOut {
  id: string;
  phone: string;
  reason: string;
  createdAt: string;
}

export type IvrActionType =
  | 'menu'
  | 'transfer'
  | 'voicemail'
  | 'message'
  | 'crm_lookup'
  | 'hangup';

export interface IvrOption {
  digit: string;
  label: string;
  action: IvrActionType;
  value?: string;
}

export interface IvrFlow {
  id: string;
  name: string;
  description: string | null;
  greeting: string;
  isActive: boolean;
  options: IvrOption[];
  updatedAt: string;
}

export interface Call {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  from: string;
  to: string;
  status: string;
  durationSec: number;
  recordingUrl: string | null;
  transcript: string | null;
  ivrPath: string[];
  startedAt: string;
  contact?: ConversationContact | null;
  agent?: { id: string; firstName: string; lastName: string } | null;
  ivrFlow?: { id: string; name: string } | null;
}

export interface CallAnalytics {
  total: number;
  answered: number;
  missed: number;
  voicemails: number;
  answerRate: number;
  totalTalkTimeSec: number;
  avgDurationSec: number;
  byStatus: Record<string, number>;
  byDirection: Record<string, number>;
  byAgent: {
    agentId: string | null;
    name: string;
    calls: number;
    talkTimeSec: number;
  }[];
}

export type CampaignStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CANCELLED';

export interface CampaignSegment {
  contactIds?: string[];
  minScore?: number;
  companyId?: string;
  ownerId?: string;
}

export interface Campaign {
  id: string;
  name: string;
  channel: string;
  status: CampaignStatus;
  subject: string | null;
  body: string | null;
  whatsappTemplateName: string | null;
  segment: CampaignSegment;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  _count?: { recipients: number };
}

export interface CampaignStats {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  opened: number;
  clicked: number;
  openRate: number;
  clickRate: number;
}

export interface CampaignPreview {
  total: number;
  reachable: number;
  unreachable: number;
  sample: { id: string; name: string; address: string | null }[];
}

export interface SequenceStep {
  id?: string;
  order?: number;
  delayHours: number;
  subject: string;
  body: string;
}

export interface Sequence {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  stopOnReply: boolean;
  steps: SequenceStep[];
  _count?: { enrollments: number };
}

export interface SequenceEnrollment {
  id: string;
  status: 'ACTIVE' | 'COMPLETED' | 'STOPPED';
  currentStep: number;
  nextRunAt: string;
  stopReason: string | null;
  contact: { id: string; firstName: string; lastName: string; email: string | null };
}

export interface ChatVisitor {
  id: string;
  visitorKey: string;
  name: string | null;
  email: string | null;
  currentPage: string | null;
  pageViews: number;
  lastSeenAt: string;
  conversationId: string | null;
  online: boolean;
}

export interface ChatRatings {
  total: number;
  average: number;
  comments: { rating: number | null; comment: string | null }[];
}

export interface EmailStats {
  sent: number;
  uniqueOpens: number;
  uniqueClicks: number;
  openRate: number;
  clickRate: number;
  topLinks: { url: string; clicks: number }[];
}

export interface AssignmentRule {
  id: string;
  name: string;
  isActive: boolean;
  priority: number;
  channel: string | null;
  conditions: { keywords?: string[] };
  strategy: string;
  assignToId: string | null;
  assignTo?: { id: string; firstName: string; lastName: string } | null;
}

export interface Mention {
  id: string;
  readAt: string | null;
  createdAt: string;
  message: {
    id: string;
    body: string | null;
    conversationId: string;
    createdAt: string;
  };
}

export type WorkflowTriggerType =
  | 'RECORD_CREATED'
  | 'RECORD_UPDATED'
  | 'FIELD_CHANGED'
  | 'DEAL_STAGE_CHANGED'
  | 'MESSAGE_RECEIVED'
  | 'CALL_COMPLETED'
  | 'SCHEDULE'
  | 'WEBHOOK';

export interface WorkflowAction {
  type: string;
  config: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  trigger: WorkflowTriggerType;
  triggerEntity: string | null;
  triggerConfig: Record<string, unknown>;
  conditions: Record<string, unknown>;
  actions: WorkflowAction[];
  runCount: number;
  lastRunAt: string | null;
  _count?: { runs: number };
}

export interface WorkflowRun {
  id: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  steps: { type: string; status: 'ok' | 'failed'; detail?: string }[];
  message: string | null;
  durationMs: number;
  createdAt: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTriggerType;
  triggerEntity?: string;
  actionCount: number;
}

export interface WorkflowAnalytics {
  totalRuns: number;
  success: number;
  failed: number;
  skipped: number;
  successRate: number;
  avgDurationMs: number;
  activeWorkflows: number;
  byWorkflow: {
    workflowId: string;
    name: string;
    runs: number;
    avgDurationMs: number;
  }[];
}

export interface ReportMeta {
  key: string;
  name: string;
  family: string;
  description: string;
  charts: string[];
}

export interface ReportResult {
  key: string;
  name: string;
  columns: { key: string; label: string; type?: 'number' | 'money' | 'text' }[];
  rows: Record<string, unknown>[];
  stats?: { label: string; value: string | number }[];
  generatedAt: string;
}

export interface DashboardWidget {
  id: string;
  title: string;
  reportKey: string;
  chart: string;
  params: Record<string, unknown>;
  position: number;
  width: string;
}

export interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  visibleToRoles: string[];
  widgets: DashboardWidget[];
}

export interface RenderedDashboard extends Omit<Dashboard, 'widgets'> {
  widgets: (DashboardWidget & {
    report: ReportResult | null;
    error: string | null;
  })[];
}

export interface ReportSchedule {
  id: string;
  name: string;
  reportKey: string;
  frequency: string;
  sendAt: string;
  recipients: string[];
  isActive: boolean;
  lastSentAt: string | null;
}

export interface InsightFactor {
  label: string;
  impact: number;
  detail: string;
}

export interface AiInsight {
  id: string;
  type: string;
  entityType: string;
  entityId: string;
  score: number | null;
  label: string | null;
  summary: string;
  factors: InsightFactor[];
  source: string;
  model: string | null;
  createdAt: string;
}

export interface ScoreboardRow {
  contactId: string;
  name: string;
  email: string | null;
  score: number;
  label: string | null;
  summary: string;
  scoredAt: string;
}

export interface AtRiskDeal {
  dealId: string;
  title: string;
  probability: number;
  label: string;
  risks: InsightFactor[];
}

export interface AiCoaching {
  action: string;
  reason: string;
  bestChannel: string | null;
  bestHour: number | null;
  bestTime: string | null;
}

export interface AiQueryResult {
  question: string;
  reportKey: string | null;
  answer: string;
  report: ReportResult | null;
  model: string;
}

export interface AiSuggestion {
  reply: string;
  model: string;
  source: string;
  draft: boolean;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unitPrice: string | number;
  currency: string;
  taxRate: string | number;
  hsnCode: string | null;
  isActive: boolean;
}

export interface PriceBook {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
  _count?: { entries: number };
}

export interface QuoteLine {
  id: string;
  productId: string | null;
  name: string;
  description: string | null;
  quantity: string | number;
  unitPrice: string | number;
  discountPercent: string | number;
  taxRate: string | number;
  lineTotal: string | number;
}

export type QuoteStatusValue =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED';

export interface Quote {
  id: string;
  number: string;
  status: QuoteStatusValue;
  currency: string;
  discountPercent: string | number;
  subtotal: string | number;
  discountAmount: string | number;
  taxAmount: string | number;
  total: string | number;
  validUntil: string | null;
  notes: string | null;
  terms: string | null;
  approvalRequired: boolean;
  acceptedByName: string | null;
  acceptedAt: string | null;
  acceptedIp: string | null;
  rejectionReason: string | null;
  lines?: QuoteLine[];
  contact?: ConversationContact | null;
  company?: { id: string; name: string } | null;
}

/** A line being built in the quote form, before the server prices it. */
export interface QuoteDraftLine {
  productId: string;
  quantity: number;
  discountPercent: number;
}

export interface PublicQuote {
  number: string;
  status: QuoteStatusValue;
  currency: string;
  subtotal: string | number;
  discountAmount: string | number;
  taxAmount: string | number;
  total: string | number;
  validUntil: string | null;
  notes: string | null;
  terms: string | null;
  expired: boolean;
  lines: QuoteLine[];
  tenant: { name: string };
  contact?: { firstName: string; lastName: string; email: string | null } | null;
  company?: { name: string } | null;
}

export interface Invoice {
  id: string;
  number: string;
  status: string;
  currency: string;
  subtotal: string | number;
  total: string | number;
  customerGstin: string | null;
  issuedAt: string | null;
  quote?: { id: string; number: string } | null;
}

export type TicketStatusValue =
  | 'OPEN'
  | 'PENDING'
  | 'ON_HOLD'
  | 'RESOLVED'
  | 'CLOSED';

export type TicketPriorityValue = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface Ticket {
  id: string;
  number: string;
  subject: string;
  description: string | null;
  status: TicketStatusValue;
  priority: TicketPriorityValue;
  category: string | null;
  tags: string[];
  channel: string | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  csatRating: number | null;
  csatComment: string | null;
  createdAt: string;
  requester?: ConversationContact | null;
  assignee?: { id: string; firstName: string; lastName: string } | null;
  _count?: { comments: number; children: number };
}

export interface TicketComment {
  id: string;
  body: string;
  isInternal: boolean;
  channel: string | null;
  createdAt: string;
}

export interface TicketDetail extends Ticket {
  comments?: TicketComment[];
  parent?: { id: string; number: string; subject: string } | null;
  children?: { id: string; number: string; subject: string; status: string }[];
  mergedInto?: { id: string; number: string } | null;
}

export interface TicketStats {
  total: number;
  byStatus: Record<string, number>;
  openByPriority: Record<string, number>;
  breached: number;
  slaCompliance: number;
  avgResolutionHours: number;
  csatResponses: number;
  csatAverage: number;
}

export interface TicketRule {
  id: string;
  name: string;
  isActive: boolean;
  priority: number;
  conditions: { keywords?: string[]; channel?: string };
  setCategory: string | null;
  setPriority: TicketPriorityValue | null;
  strategy: string;
  assignTo?: { id: string; firstName: string; lastName: string } | null;
}

export interface CsatSurvey {
  number: string;
  subject: string;
  status: string;
  csatRating: number | null;
  alreadyRated: boolean;
  tenant: { name: string };
}

// ── Knowledge base ─────────────────────────────

export type ArticleStatusValue = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ArticleVisibilityValue = 'PUBLIC' | 'INTERNAL';

export interface ArticleCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  _count?: { articles: number };
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  status: ArticleStatusValue;
  visibility: ArticleVisibilityValue;
  locale: string;
  tags: string[];
  version: number;
  viewCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  publishedAt: string | null;
  updatedAt: string;
  category: { id: string; name: string } | null;
  author?: { id: string; firstName: string; lastName: string } | null;
  _count?: { versions: number; translations: number };
}

export interface ArticleVersionSummary {
  id: string;
  version: number;
  title: string;
  note: string | null;
  createdAt: string;
}

export interface ArticleDetail extends Article {
  /** True when the working copy has moved on from what the help centre serves */
  unpublishedChanges: boolean;
  versions: ArticleVersionSummary[];
  translations: {
    id: string;
    locale: string;
    title: string;
    status: ArticleStatusValue;
  }[];
  translationOf: { id: string; locale: string; title: string } | null;
  feedback: { helpful: boolean; comment: string | null; createdAt: string }[];
}

export interface KbStats {
  total: number;
  published: number;
  drafts: number;
  internal: number;
  totalViews: number;
  mostViewed: { title: string; slug: string; views: number }[];
  needsWork: {
    title: string;
    slug: string;
    helpful: number;
    notHelpful: number;
  }[];
}

export interface KbSearchAnalytics {
  totalSearches: number;
  noResults: number;
  noResultRate: number;
  topQueries: { query: string; searches: number; misses: number }[];
  gaps: { query: string; searches: number; misses: number }[];
}

export interface KbSuggestion {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  visibility: ArticleVisibilityValue;
  category: { id: string; name: string } | null;
  score: number;
}

// ── Customer portal ────────────────────────────

export interface PortalAccount {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  tenant: string;
}

export interface PortalTicket {
  id: string;
  number: string;
  subject: string;
  status: TicketStatusValue;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface PortalTicketDetail extends PortalTicket {
  description: string | null;
  csatRating: number | null;
  assignee: { firstName: string } | null;
  comments: {
    id: string;
    body: string;
    createdAt: string;
    /** "You" for the customer's own replies, otherwise the agent's name */
    from: string;
    mine: boolean;
  }[];
}

export interface PortalQuote {
  number: string;
  status: string;
  currency: string;
  total: string;
  validUntil: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  /** Path to the existing customer-facing quote page */
  path: string;
}

export interface PortalInvoice {
  number: string;
  status: string;
  currency: string;
  total: string;
  dueAt: string | null;
  issuedAt: string | null;
  paidAt: string | null;
}

/** A search result on the public help centre */
export interface HelpResult {
  slug: string;
  title: string;
  excerpt: string | null;
  locale: string;
  tags: string[];
  category: { id: string; name: string } | null;
  helpfulCount: number;
}

export interface HelpCentre {
  tenant: { name: string };
  query: string | null;
  results: HelpResult[];
}

export interface HelpArticle {
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  locale: string;
  tags: string[];
  category: { id: string; name: string } | null;
  tenant: { name: string };
  translations: { slug: string; locale: string; title: string }[];
  helpfulCount: number;
  notHelpfulCount: number;
  updatedAt: string;
}

// ── Territories, forecasting, gamification ─────

export interface TerritoryRules {
  countries?: string[];
  states?: string[];
  cities?: string[];
  industries?: string[];
  domains?: string[];
  minEmployees?: number;
  maxEmployees?: number;
}

export interface Territory {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  isActive: boolean;
  rules: TerritoryRules;
  manager: { id: string; firstName: string; lastName: string } | null;
  members: { user: { id: string; firstName: string; lastName: string } }[];
  _count: { companies: number; children: number };
}

export interface TerritoryPerformance {
  id: string;
  name: string;
  parentId: string | null;
  accounts: number;
  deals: number;
  won: number;
  open: number;
  lost: number;
  winRate: number;
}

export type QuotaPeriodValue = 'MONTH' | 'QUARTER' | 'YEAR';

export interface Quota {
  id: string;
  period: QuotaPeriodValue;
  periodStart: string;
  amount: string;
  currency: string;
  owner: { id: string; firstName: string; lastName: string } | null;
  territory: { id: string; name: string } | null;
}

export interface ForecastRow {
  ownerId: string | null;
  owner: string;
  quota: number;
  closed: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  omitted: number;
  weighted: number;
  deals: number;
  attainment: number | null;
  gap: number | null;
  projected?: number;
  projectedAttainment?: number | null;
}

export interface Forecast {
  period: QuotaPeriodValue;
  periodStart: string;
  periodEnd: string;
  rows: ForecastRow[];
  total: {
    quota: number;
    closed: number;
    commit: number;
    bestCase: number;
    pipeline: number;
    weighted: number;
    deals: number;
    projected?: number;
    projectedAttainment?: number | null;
    shortfall?: number | null;
  };
  dealsWithoutExpectedDate: number;
  odds?: { commit: number; bestCase: number; pipeline: number };
}

export interface ForecastAccuracy {
  owner: string;
  periodStart: string;
  period: QuotaPeriodValue;
  takenAt: string;
  called: number;
  actual: number;
  accuracy: number | null;
}

export type ContestMetricValue =
  | 'REVENUE_WON'
  | 'DEALS_WON'
  | 'CALLS_MADE'
  | 'MEETINGS_HELD'
  | 'TICKETS_RESOLVED';

export interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string;
  revenueWon: number;
  dealsWon: number;
  callsMade: number;
  meetingsHeld: number;
  ticketsResolved: number;
  points: number;
  value?: number;
}

export interface Leaderboard {
  from: string;
  to: string | null;
  metric: ContestMetricValue | null;
  rows: LeaderboardRow[];
}

export interface Contest {
  id: string;
  name: string;
  metric: ContestMetricValue;
  startsAt: string;
  endsAt: string;
  prize: string | null;
}

export interface ContestStandings {
  contest: Contest;
  running: boolean;
  rows: { rank: number; userId: string; name: string; value: number }[];
}

export interface BadgeDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  metric: ContestMetricValue;
  threshold: string;
  earned: {
    earnedAt: string;
    value: string;
    user: { id: string; firstName: string; lastName: string };
  }[];
}

// ── Marketing ──────────────────────────────────

export type LeadStatusValue =
  | 'NEW'
  | 'WORKING'
  | 'NURTURING'
  | 'QUALIFIED'
  | 'CONVERTED'
  | 'DISQUALIFIED';

export interface Lead {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  status: LeadStatusValue;
  score: number;
  source: string | null;
  sourceDetail: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  createdAt: string;
  convertedContactId: string | null;
  convertedDealId: string | null;
  owner: { id: string; firstName: string; lastName: string } | null;
  _count?: { touchpoints: number };
}

export interface LeadDetail extends Lead {
  factors: { label: string; points: number }[];
  touchpoints: {
    id: string;
    type: string;
    occurredAt: string;
    detail: Record<string, unknown>;
    campaign: { id: string; name: string } | null;
    page: { id: string; title: string; slug: string } | null;
  }[];
}

export interface FormField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
}

export interface MarketingForm {
  id: string;
  name: string;
  fields: FormField[];
  thankYou: string;
  assignTo: { id: string; firstName: string; lastName: string } | null;
  _count: { submissions: number; pages: number };
}

export interface PageBlock {
  type: 'heading' | 'text' | 'image' | 'form' | 'button';
  text?: string;
  src?: string;
  alt?: string;
  href?: string;
}

export type PageStatusValue = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface LandingPage {
  id: string;
  slug: string;
  title: string;
  status: PageStatusValue;
  blocks: PageBlock[];
  metaTitle: string | null;
  metaDescription: string | null;
  variantOfId: string | null;
  variantWeight: number;
  views: number;
  submissions: number;
  form: { id: string; name: string } | null;
  variantOf: { id: string; title: string } | null;
  _count?: { variants: number };
}

export interface PageStat {
  id: string;
  slug: string;
  title: string;
  status: PageStatusValue;
  views: number;
  submissions: number;
  variantOfId: string | null;
  conversionRate: number;
}

export interface AttributionReport {
  model: string;
  wonRevenue: number;
  creditedRevenue: number;
  uncreditedRevenue: number;
  rows: {
    key: string;
    kind: string;
    label: string;
    revenue: number;
    deals: number;
  }[];
}

export interface CampaignRoi {
  model: string;
  rows: {
    id: string;
    name: string;
    channel: string;
    status: string;
    cost: number;
    currency: string;
    audience: number;
    sent: number;
    opened: number;
    clicked: number;
    revenue: number;
    roi: number | null;
    costPerSend: number | null;
  }[];
}

export interface FunnelStep {
  step: string;
  count: number;
  ofTotal: number;
  dropOff: number;
}

export interface LeadSourceRow {
  source: string;
  leads: number;
  converted: number;
  conversionRate: number;
  averageScore: number;
}

/** What the public landing page endpoint returns */
export interface PublicPage {
  variantId: string;
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string | null;
  blocks: PageBlock[];
  tenant: { name: string };
  form: { id: string; fields: FormField[]; thankYou: string } | null;
}

// ── Documents ──────────────────────────────────

export interface DocumentFolder {
  id: string;
  name: string;
  parentId: string | null;
  _count: { documents: number; children: number };
}

export interface CrmDocument {
  id: string;
  name: string;
  tags: string[];
  mimeType: string;
  size: number;
  version: number;
  expiresAt: string | null;
  updatedAt: string;
  folder: { id: string; name: string } | null;
  owner: { id: string; firstName: string; lastName: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  _count?: { versions: number; shares: number };
}

export interface DocumentShare {
  id: string;
  token: string;
  version: number;
  expiresAt: string | null;
  revokedAt: string | null;
  requireSignature: boolean;
  views: number;
  downloads: number;
  lastSeenAt: string | null;
  signedName: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface DocumentDetail extends CrmDocument {
  versions: {
    id: string;
    version: number;
    size: number;
    note: string | null;
    createdAt: string;
    author: { firstName: string; lastName: string } | null;
  }[];
  shares: DocumentShare[];
}

export interface DocumentActivity {
  views: number;
  downloads: number;
  averageSeconds: number | null;
  events: {
    id: string;
    type: string;
    ipAddress: string | null;
    seconds: number | null;
    createdAt: string;
  }[];
}

export interface DocumentTemplate {
  id: string;
  name: string;
  kind: string;
  body: string;
}

export interface ExpiringDocument {
  id: string;
  name: string;
  expiresAt: string;
  company: string | null;
  owner: string | null;
  daysLeft: number;
}

/** What the public share link returns */
export interface SharedDocument {
  name: string;
  mimeType: string;
  size: number;
  sharedBy: string;
  requireSignature: boolean;
  signed: boolean;
  signedName: string | null;
  expiresAt: string | null;
}
