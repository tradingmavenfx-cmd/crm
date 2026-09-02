/**
 * Emitted when an agent posts a public comment on a ticket.
 *
 * The portal listens for it: a customer whose reply did not go out on a
 * channel has no other way of learning there is an answer waiting.
 */
export const TICKET_REPLY_EVENT = 'ticket.public_reply';

export interface TicketReplyEvent {
  tenantId: string;
  ticketId: string;
  /** True when the reply already reached the customer over their channel */
  delivered: boolean;
}
