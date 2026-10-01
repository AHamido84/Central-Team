import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import { classifyProviderFailure } from '@/modules/ai/errors';
import { AiProviderError, type AiCompleter, type AiPurpose, type AiTurn } from '@/modules/ai/providers/types';

/** Effort per purpose: routine writing runs at `low`, the assistant (tools + synthesis) at `medium`. */
const effort: Record<AiPurpose, 'low' | 'medium'> = { assistant: 'medium', report_draft: 'low', insight_explain: 'low' };

/**
 * One request may take this long before we give up (ADR-089): with one retry the worst case stays well inside the
 * routes' `maxDuration` (300 s on Vercel), so a slow provider ends as "timed out" in the thread, never as a killed
 * function.
 */
export const ANTHROPIC_TIMEOUT_MS = 90_000;

function toMessages(turns: readonly AiTurn[]): Anthropic.Beta.BetaMessageParam[] {
  return turns.map((t): Anthropic.Beta.BetaMessageParam => {
    // The provider's own blocks (text, thinking, tool_use) go back unchanged: the loop only ever appends.
    if (t.role === 'assistant' && t.raw) return { role: 'assistant', content: t.raw as Anthropic.Beta.BetaContentBlockParam[] };
    if (t.toolResults?.length) {
      return {
        role: 'user',
        content: t.toolResults.map((r) => ({ type: 'tool_result', tool_use_id: r.toolUseId, content: r.content, is_error: r.isError })),
      };
    }
    return { role: t.role, content: t.content };
  });
}

/** Maps an SDK error to our taxonomy (the detail goes to the log, never to people). */
export function anthropicFailure(error: unknown): AiProviderError {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError('ai_timeout', error.message);
  if (error instanceof Anthropic.APIConnectionError) return new AiProviderError('ai_unavailable', error.message);
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { error?: { type?: string; message?: string } } | undefined;
    const code = classifyProviderFailure({ status: error.status, type: body?.error?.type, message: body?.error?.message ?? error.message });
    return new AiProviderError(code, `${error.status}: ${error.message}`);
  }
  return new AiProviderError('ai_unavailable', error instanceof Error ? error.message : String(error));
}

/**
 * Claude through the official SDK (ADR-073). Thinking is adaptive by default on the configured model, so only effort
 * is set. `fallbacks: "default"` lets the API re-run a declined request on Anthropic's recommended fallback model; a
 * final `refusal` is returned as such and shown as a translated message. Tools use `tool_choice: auto` (forced tool use
 * is not accepted by current models); the assistant loop runs them (ADR-090).
 */
export function anthropicCompleter(config: { apiKey: string; model: string }): AiCompleter {
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 1, timeout: ANTHROPIC_TIMEOUT_MS });
  return {
    key: 'anthropic',
    model: config.model,
    async complete(input) {
      try {
        const res = await client.beta.messages.create({
          model: config.model,
          max_tokens: 16000,
          system: input.system,
          messages: toMessages(input.messages),
          ...(input.tools?.length
            ? {
                tools: input.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
                })),
                tool_choice: { type: input.toolChoice ?? 'auto' },
              }
            : {}),
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
        if (res.stop_reason === 'tool_use') {
          const toolCalls = res.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []));
          return { text, stop: 'tool_use', model: res.model, usage, toolCalls, raw: res.content };
        }
        return { text, stop: res.stop_reason === 'max_tokens' ? 'max_tokens' : 'end', model: res.model, usage, raw: res.content };
      } catch (error) {
        throw anthropicFailure(error);
      }
    },
  };
}
