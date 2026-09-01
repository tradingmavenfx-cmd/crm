/**
 * Every report the API can produce. The registry is the contract the frontend
 * builds against: a widget stores a `key` from here, not a query.
 */
export interface ReportMeta {
  key: string;
  name: string;
  /** sales | marketing | service | communication */
  family: string;
  description: string;
  /** Chart types that suit this report's shape */
  charts: string[];
}

export const REPORTS: ReportMeta[] = [
  // ── Sales ──────────────────────────────────────
  {
    key: 'sales.pipeline',
    name: 'Pipeline by stage',
    family: 'sales',
    description: 'Open deals and their value at each stage.',
    charts: ['funnel', 'bar', 'table'],
  },
  {
    key: 'sales.forecast',
    name: 'Revenue forecast',
    family: 'sales',
    description:
      'Open pipeline weighted by each stage probability, split by expected close month.',
    charts: ['bar', 'line', 'table'],
  },
  {
    key: 'sales.leaderboard',
    name: 'Sales rep leaderboard',
    family: 'sales',
    description: 'Won revenue, deals closed and open pipeline per owner.',
    charts: ['bar', 'table'],
  },
  {
    key: 'sales.win_loss',
    name: 'Win / loss analysis',
    family: 'sales',
    description: 'Won against lost, by count and value, with the win rate.',
    charts: ['donut', 'table'],
  },
  {
    key: 'sales.cycle',
    name: 'Sales cycle length',
    family: 'sales',
    description: 'How long deals take from creation to close, won versus lost.',
    charts: ['bar', 'table'],
  },

  // ── Marketing ──────────────────────────────────
  {
    key: 'marketing.campaigns',
    name: 'Campaign performance',
    family: 'marketing',
    description: 'Sent, skipped, failed, opened and clicked per campaign.',
    charts: ['bar', 'table'],
  },
  {
    key: 'marketing.channel_attribution',
    name: 'Channel attribution',
    family: 'marketing',
    description:
      'Conversations and contacts reached on each channel, so you can see which one carries the relationship.',
    charts: ['donut', 'bar', 'table'],
  },
  {
    key: 'marketing.email',
    name: 'Email performance',
    family: 'marketing',
    description: 'Delivery, opens and clicks across all outbound email.',
    charts: ['stat', 'table'],
  },

  // ── Service ────────────────────────────────────
  {
    key: 'service.first_response',
    name: 'First response time',
    family: 'service',
    description:
      'How quickly the team first replies on each channel, and how much of that meets the SLA target.',
    charts: ['bar', 'table'],
  },
  {
    key: 'service.agent_performance',
    name: 'Agent performance',
    family: 'service',
    description:
      'Conversations handled, median first response, calls taken and tasks completed per agent.',
    charts: ['bar', 'table'],
  },
  {
    key: 'service.csat',
    name: 'Chat satisfaction',
    family: 'service',
    description: 'Post-chat ratings and their distribution.',
    charts: ['donut', 'stat', 'table'],
  },

  // ── Communication ──────────────────────────────
  {
    key: 'comms.calls',
    name: 'Call analytics',
    family: 'communication',
    description: 'Volume, answer rate and talk time, overall and per agent.',
    charts: ['bar', 'stat', 'table'],
  },
  {
    key: 'comms.omnichannel',
    name: 'Omnichannel engagement',
    family: 'communication',
    description: 'Messages per channel per day, inbound against outbound.',
    charts: ['line', 'bar', 'table'],
  },
  {
    key: 'comms.volume_by_channel',
    name: 'Message volume by channel',
    family: 'communication',
    description: 'Total messages exchanged on each channel.',
    charts: ['donut', 'bar', 'table'],
  },

  // ── Activity ───────────────────────────────────
  {
    key: 'activity.tasks',
    name: 'Task load',
    family: 'service',
    description: 'Open, overdue and completed tasks per assignee.',
    charts: ['bar', 'table'],
  },
];

export const REPORT_KEYS = REPORTS.map((r) => r.key);
