import { EditPlan, CompactAnalysisSummary, PlannerExecutionMode } from '@ai-video/shared';

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
  model?: string;
  strictLlm?: boolean;
}

export interface PlannerProviderOutput {
  provider: 'gemini' | 'openai';
  model: string;
  structuredOutput: unknown;
  executionMode?: PlannerExecutionMode;
  isFallback?: boolean;
  requestedModel?: string;
  fallbackReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  providerRequestId?: string;
}

export interface PlannerProvider {
  generateEditPlan(input: PlannerProviderInput): Promise<PlannerProviderOutput>;
}
