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
