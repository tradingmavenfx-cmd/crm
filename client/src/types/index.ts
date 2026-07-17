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
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  body: string | null;
  status: string;
  isInternal: boolean;
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
