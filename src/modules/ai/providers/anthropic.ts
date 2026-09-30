import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import { AiProviderError, type AiCompleter, type AiPurpose } from '@/modules/ai/providers/types';

/** Effort per purpose: routine writing runs at `low`, the assistant (retrieval + synthesis) at `medium`. */
const effort: Record<AiPurpose, 'low' | 'medium'> = { assistant: 'medium', report_draft: 'low', insight_explain: 'low' };

/**
 * Claude through the official SDK (ADR-073). Thinking is adaptive by default on the configured model, so only effort
 * is set. `fallbacks: "default"` lets the API re-run a declined request on Anthropic's recommended fallback model; a
 * final `refusal` is returned as such and shown as a translated message.
 */
export function anthropicCompleter(config: { apiKey: string; model: string }): AiCompleter {
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 120_000 });
  return {
    key: 'anthropic',
    model: config.model,
    async complete(input) {
      try {
        const res = await client.beta.messages.create({
          model: config.model,
          max_tokens: 16000,
          system: input.system,
          messages: input.messages,
          output_config: { effort: effort[input.purpose] },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
        const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens };
        if (res.stop_reason === 'refusal') return { text: '', stop: 'refusal', model: res.model, usage };
        const text = res.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        return { text, stop: res.stop_reason === 'max_tokens' ? 'max_tokens' : 'end', model: res.model, usage };
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
          throw new AiProviderError('ai_not_configured', error.message);
        }
        if (error instanceof Anthropic.APIError) throw new AiProviderError('ai_unavailable', `${error.status}: ${error.message}`);
        throw new AiProviderError('ai_unavailable', error instanceof Error ? error.message : String(error));
      }
    },
  };
}
