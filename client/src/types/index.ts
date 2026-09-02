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
