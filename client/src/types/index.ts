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
