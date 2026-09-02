export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AiCompletionInput {
  messages: AiMessage[];
  /** Ask the provider for strict JSON back */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface AiCompletionResult {
  text: string;
  /** Which model actually answered, for the audit trail on an insight */
  model: string;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/**
 * The narrow surface the CRM needs from a language model: one completion call.
 * Everything domain-specific (scoring, coaching, sentiment) is built on top of
 * it, so swapping providers never touches the CRM logic.
 */
export interface AiProvider {
  readonly name: string;
  complete(input: AiCompletionInput): Promise<AiCompletionResult>;
}
