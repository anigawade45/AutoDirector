import OpenAI from 'openai';
import { env } from '../../config/env.js';
import {
  PlannerProvider,
  PlannerProviderInput,
  PlannerProviderOutput,
} from './plannerProvider.interface.js';
import { GeminiPlannerAdapter } from './geminiAdapter.js';
import { AppError } from '../../middleware/errorHandler.js';
import { MetricsService } from '../observability/metrics.js';

export class OpenAIPlannerAdapter implements PlannerProvider {
  private client: OpenAI | null = null;
  private fallbackAdapter = new GeminiPlannerAdapter();

  constructor(client?: OpenAI | null) {
    if (client !== undefined) {
      this.client = client;
    } else if (
      env.OPENAI_API_KEY &&
      (!process.env.VITEST || process.env.ALLOW_LIVE_LLM_TESTS === 'true')
    ) {
      this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    }
  }

  async generateEditPlan(input: PlannerProviderInput): Promise<PlannerProviderOutput> {
    const targetModel = input.model || env.AI_MODEL || 'gpt-4o';
    const isStrict = input.strictLlm ?? !env.ALLOW_HEURISTIC_FALLBACK;

    if (!this.client) {
      if (isStrict) {
        MetricsService.recordPlannerExecution({
          provider: 'openai',
          requestedModel: targetModel,
          actualModel: 'none',
          executionMode: 'heuristic_fallback',
          isFallback: true,
          fallbackReason: 'OpenAI API client not initialized (missing OPENAI_API_KEY)',
        });
        throw new AppError(
          502,
          'UPSTREAM_LLM_UNAVAILABLE',
          'OpenAI API client not initialized (missing OPENAI_API_KEY). Heuristic fallback prohibited in strict mode.'
        );
      }
      return this.fallbackAdapter.generateEditPlan(input);
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: targetModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: input.systemInstructions },
          { role: 'user', content: input.userPrompt },
        ],
      });

      const choice = completion.choices[0];
      let text = choice?.message?.content;

      if (!text) {
        throw new Error('OpenAI returned an empty content payload');
      }

      text = text.trim();
      if (text.startsWith('```')) {
        text = text
          .replace(/^```(json)?\n?/, '')
          .replace(/\n?```$/, '')
          .trim();
      }

      const structuredOutput = JSON.parse(text);

      MetricsService.recordPlannerExecution({
        provider: 'openai',
        requestedModel: targetModel,
        actualModel: targetModel,
        executionMode: 'primary_llm',
        isFallback: false,
      });

      return {
        provider: 'openai',
        model: targetModel,
        structuredOutput,
        executionMode: 'primary_llm',
        isFallback: false,
        requestedModel: targetModel,
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
        },
        providerRequestId: completion.id,
      };
    } catch (err: any) {
      console.warn(`[OpenAIPlannerAdapter] Remote call failed (${err.message}). Falling back.`);
      if (isStrict) {
        MetricsService.recordPlannerExecution({
          provider: 'openai',
          requestedModel: targetModel,
          actualModel: 'none',
          executionMode: 'heuristic_fallback',
          isFallback: true,
          fallbackReason: err.message,
        });
        throw new AppError(
          502,
          'UPSTREAM_LLM_UNAVAILABLE',
          `Upstream OpenAI call failed: ${err.message}. Heuristic fallback prohibited in strict mode.`
        );
      }
      return this.fallbackAdapter.generateEditPlan(input);
    }
  }
}
