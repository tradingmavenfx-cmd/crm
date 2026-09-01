import { WorkflowTrigger } from '@prisma/client';
import { WorkflowActionDto } from './dto/workflow.dto';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  triggerEntity?: string;
  triggerConfig?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  actions: WorkflowActionDto[];
}

/**
 * Starting points covering the workflows the plan calls out. Installing one
 * creates it paused so it can be reviewed and edited before it starts firing.
 */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'lead-assignment',
    name: 'Lead assignment',
    description:
      'Every new contact is handed to the agent with the fewest open tasks, with a follow-up task due the same day.',
    trigger: WorkflowTrigger.RECORD_CREATED,
    triggerEntity: 'contact',
    conditions: {},
    actions: [
      { type: 'assign_owner', config: { strategy: 'round_robin' } },
      {
        type: 'create_task',
        config: {
          title: 'Qualify new lead {{firstName}} {{lastName}}',
          priority: 'high',
          dueInHours: 8,
        },
      },
    ],
  },
  {
    id: 'hot-lead-alert',
    name: 'Hot lead alert',
    description:
      'When a contact score rises to 80 or above, text the owner a heads-up and log the moment on the timeline.',
    trigger: WorkflowTrigger.FIELD_CHANGED,
    triggerEntity: 'contact',
    triggerConfig: { field: 'score' },
    conditions: { all: [{ field: 'score', op: 'gte', value: 80 }] },
    actions: [
      {
        type: 'create_activity',
        config: {
          type: 'NOTE',
          subject: '{{firstName}} {{lastName}} became a hot lead',
          body: 'Score reached {{score}}.',
        },
      },
      {
        type: 'create_task',
        config: {
          title: 'Call {{firstName}} today - score {{score}}',
          priority: 'high',
          dueInHours: 4,
        },
      },
    ],
  },
  {
    id: 'deal-stage-automation',
    name: 'Deal stage automation',
    description:
      'When a deal moves stage, log it and put a next-step task on the deal owner.',
    trigger: WorkflowTrigger.DEAL_STAGE_CHANGED,
    triggerEntity: 'deal',
    conditions: {},
    actions: [
      {
        type: 'create_task',
        config: {
          title: 'Next step on {{title}}',
          description: 'The deal just moved stage - agree the next action.',
          priority: 'medium',
          dueInHours: 24,
        },
      },
    ],
  },
  {
    id: 'customer-onboarding',
    name: 'Customer onboarding',
    description:
      'A won deal kicks off the onboarding email and an internal checklist task.',
    trigger: WorkflowTrigger.FIELD_CHANGED,
    triggerEntity: 'deal',
    triggerConfig: { field: 'status', to: 'won' },
    conditions: {},
    actions: [
      {
        type: 'create_task',
        config: {
          title: 'Kick off onboarding for {{title}}',
          priority: 'high',
          dueInHours: 24,
        },
      },
    ],
  },
  {
    id: 'escalation',
    name: 'Support escalation',
    description:
      'An inbound message mentioning urgent or complaint raises a high-priority task straight away.',
    trigger: WorkflowTrigger.MESSAGE_RECEIVED,
    conditions: {
      any: [
        { field: 'body', op: 'contains', value: 'urgent' },
        { field: 'body', op: 'contains', value: 'complaint' },
        { field: 'body', op: 'contains', value: 'not working' },
      ],
    },
    actions: [
      {
        type: 'create_task',
        config: {
          title: 'Escalation from {{externalId}}',
          description: 'Message: {{body}}',
          priority: 'high',
          dueInHours: 2,
        },
      },
    ],
  },
  {
    id: 'renewal-reminder',
    name: 'Renewal reminder sweep',
    description:
      'Runs every morning at 9am so renewals due soon get picked up. Add your own conditions to narrow it.',
    trigger: WorkflowTrigger.SCHEDULE,
    triggerConfig: { dailyAt: '09:00' },
    conditions: {},
    actions: [
      {
        type: 'create_task',
        config: {
          title: 'Review renewals due this week',
          priority: 'medium',
          dueInHours: 8,
        },
      },
    ],
  },
];
