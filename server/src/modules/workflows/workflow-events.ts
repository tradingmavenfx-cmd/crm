import { Channel, WorkflowTrigger } from '@prisma/client';

/**
 * Domain events the workflow engine listens for. Channels and CRM modules emit
 * these through EventEmitter2 and never import the engine, which keeps the
 * dependency arrows pointing one way.
 */
export const WORKFLOW_EVENT = 'workflow.trigger';

export type WorkflowEntity = 'contact' | 'company' | 'deal' | 'task';

export interface WorkflowEvent {
  tenantId: string;
  trigger: WorkflowTrigger;
  /** Record type for record-shaped triggers */
  entity?: WorkflowEntity;
  /** The record as it now stands - the condition tree is evaluated against it */
  record: Record<string, unknown>;
  /** Field-level detail for FIELD_CHANGED / DEAL_STAGE_CHANGED */
  changed?: { field: string; from: unknown; to: unknown };
  /** Channel for MESSAGE_RECEIVED */
  channel?: Channel;
  /** Key that identifies which webhook fired, for WEBHOOK */
  webhookKey?: string;
}

/** Convenience builder so emitters read the same way everywhere. */
export function workflowEvent(event: WorkflowEvent): WorkflowEvent {
  return event;
}
