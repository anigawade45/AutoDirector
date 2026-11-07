import OpenAI from 'openai';
import { env } from '../../config/env.js';
import {
  PlannerProvider,
  PlannerProviderInput,
  PlannerProviderOutput,
} from './plannerProvider.interface.js';
import { GeminiPlannerAdapter } from './geminiAdapter.js';

export class OpenAIPlannerAdapter implements PlannerProvider {
  private client: OpenAI | null = null;
  private fallbackAdapter = new GeminiPlannerAdapter();

  constructor() {
    if (env.OPENAI_API_KEY) {
      this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    }
  }

  async generateEditPlan(input: PlannerProviderInput): Promise<PlannerProviderOutput> {
    if (!this.client) {
      return this.fallbackAdapter.generateEditPlan(input);
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: env.AI_MODEL || 'gpt-4o',
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

      return {
        provider: 'openai',
        model: env.AI_MODEL || 'gpt-4o',
        structuredOutput,
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
        },
        providerRequestId: completion.id,
      };
    } catch (err: any) {
      console.warn(`[OpenAIPlannerAdapter] Remote call failed (${err.message}). Falling back.`);
      return this.fallbackAdapter.generateEditPlan(input);
    }
  }
}
