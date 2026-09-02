import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiCompletionInput,
  AiCompletionResult,
  AiProvider,
} from './ai-provider.interface';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  model?: string;
  error?: { message?: string };
}

/**
 * Real provider: the OpenAI Chat Completions API over the global fetch, so no
 * SDK dependency - the same shape as the Twilio and Meta providers.
 *
 * This needs a platform API key (OPENAI_API_KEY). The "sign in with ChatGPT"
 * OAuth flow belongs to the Codex CLI on a developer's own machine and does not
 * authorise a server to call models, so it is not an option here.
 */
@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly logger = new Logger('AiOpenAI');

  constructor(private readonly config: ConfigService) {}

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const apiKey = this.config.get<string>('ai.apiKey');
    const model = this.config.get<string>('ai.model');
    const baseUrl =
      this.config.get<string>('ai.baseUrl') ?? 'https://api.openai.com/v1';

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 600,
        ...(input.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    const data = (await res.json()) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content;

    if (!res.ok || !text) {
      this.logger.error(
        `Completion failed: ${data.error?.message ?? res.status}`,
      );
      throw new InternalServerErrorException('AI request failed');
    }

    return { text, model: data.model ?? model ?? 'openai' };
  }
}
