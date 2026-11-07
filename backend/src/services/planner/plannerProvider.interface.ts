import { EditPlan, CompactAnalysisSummary } from '@ai-video/shared';

export interface AllowedCatalog {
  templates: Array<{ id: string; name: string }>;
  luts: Array<{ id: string; name: string }>;
  music: Array<{ id: string; name: string; mood: string }>;
  fonts: string[];
}

export interface PlannerProviderInput {
  systemInstructions: string;
  userPrompt: string;
  currentPlan?: EditPlan;
  analysisSummary: CompactAnalysisSummary;
  catalog: AllowedCatalog;
  outputSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface PlannerProviderOutput {
  provider: 'gemini' | 'openai';
  model: string;
  structuredOutput: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  providerRequestId?: string;
}

export interface PlannerProvider {
  generateEditPlan(input: PlannerProviderInput): Promise<PlannerProviderOutput>;
}
