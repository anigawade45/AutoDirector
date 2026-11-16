import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiPlannerAdapter } from '../services/planner/geminiAdapter.js';
import { OpenAIPlannerAdapter } from '../services/planner/openaiAdapter.js';
import { PlannerService } from '../services/planner/plannerService.js';
import { MetricsService } from '../services/observability/metrics.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  PlannerProvider,
  PlannerProviderInput,
  PlannerProviderOutput,
} from '../services/planner/plannerProvider.interface.js';

describe('Planner Fallback Behavior & Upstream LLM Observability Suite', () => {
  beforeEach(() => {
    MetricsService.reset();
  });

  describe('1. GeminiPlannerAdapter Fallback & Strict Mode', () => {
    it('returns heuristic_fallback with executionMode and fallbackReason when client has no key and strictLlm is false', async () => {
      const adapter = new GeminiPlannerAdapter();
      (adapter as any).client = null;
      const input: PlannerProviderInput = {
        systemInstructions: 'System instructions',
        userPrompt: JSON.stringify({
          instruction: 'Make it vertical with teal orange LUT',
          context: {},
        }),
        analysisSummary: {
          durationMs: 30000,
          width: 1920,
          height: 1080,
          fps: 30,
          silences: [],
          sceneCuts: [],
          beats: { bpm: 120, grid: [] },
          loudness: { integratedLufs: -16, truePeakDb: -1.5 },
          transcriptExcerpt: [],
        },
        catalog: { templates: [], luts: [], music: [], fonts: [] },
        strictLlm: false,
      };

      const result = await adapter.generateEditPlan(input);

      expect(result.executionMode).toBe('heuristic_fallback');
      expect(result.isFallback).toBe(true);
      expect(result.model).toBe('rule-engine-v1');
      expect(result.fallbackReason).toBeDefined();
      expect((result.structuredOutput as any)?.meta?.executionMode).toBe('heuristic_fallback');
    });

    it('rejects with 502 UPSTREAM_LLM_UNAVAILABLE when strictLlm is true and LLM is unconfigured', async () => {
      const adapter = new GeminiPlannerAdapter();
      (adapter as any).client = null;
      const input: PlannerProviderInput = {
        systemInstructions: 'System instructions',
        userPrompt: JSON.stringify({ instruction: 'Make it vertical', context: {} }),
        analysisSummary: {
          durationMs: 30000,
          width: 1920,
          height: 1080,
          fps: 30,
          silences: [],
          sceneCuts: [],
          beats: { bpm: 120, grid: [] },
          loudness: { integratedLufs: -16, truePeakDb: -1.5 },
          transcriptExcerpt: [],
        },
        catalog: { templates: [], luts: [], music: [], fonts: [] },
        strictLlm: true,
      };

      await expect(adapter.generateEditPlan(input)).rejects.toThrow(AppError);

      try {
        await adapter.generateEditPlan(input);
      } catch (err: any) {
        expect(err.statusCode).toBe(502);
        expect(err.code).toBe('UPSTREAM_LLM_UNAVAILABLE');
        expect(err.message).toContain('Heuristic fallback prohibited in strict mode');
      }
    });

    it('rejects with 502 UPSTREAM_LLM_UNAVAILABLE when strictLlm is true and remote LLM call fails', async () => {
      const adapter = new GeminiPlannerAdapter();
      (adapter as any).client = {
        getGenerativeModel: () => ({
          generateContent: async () => {
            throw new Error('Google Generative AI 429 ResourceExhausted');
          },
        }),
      };
      const input: PlannerProviderInput = {
        systemInstructions: 'System instructions',
        userPrompt: JSON.stringify({ instruction: 'Make it vertical', context: {} }),
        analysisSummary: {
          durationMs: 30000,
          width: 1920,
          height: 1080,
          fps: 30,
          silences: [],
          sceneCuts: [],
          beats: { bpm: 120, grid: [] },
          loudness: { integratedLufs: -16, truePeakDb: -1.5 },
          transcriptExcerpt: [],
        },
        catalog: { templates: [], luts: [], music: [], fonts: [] },
        strictLlm: true,
      };

      await expect(adapter.generateEditPlan(input)).rejects.toThrow(AppError);

      try {
        await adapter.generateEditPlan(input);
      } catch (err: any) {
        expect(err.statusCode).toBe(502);
        expect(err.code).toBe('UPSTREAM_LLM_UNAVAILABLE');
        expect(err.message).toContain('ResourceExhausted');
      }
    });
  });

  describe('2. OpenAIPlannerAdapter Fallback & Strict Mode', () => {
    it('rejects with 502 UPSTREAM_LLM_UNAVAILABLE when strictLlm is true and client is unconfigured', async () => {
      const adapter = new OpenAIPlannerAdapter();
      const input: PlannerProviderInput = {
        systemInstructions: 'System instructions',
        userPrompt: JSON.stringify({ instruction: 'Cinematic color grade', context: {} }),
        analysisSummary: {
          durationMs: 30000,
          width: 1920,
          height: 1080,
          fps: 30,
          silences: [],
          sceneCuts: [],
          beats: { bpm: 120, grid: [] },
          loudness: { integratedLufs: -16, truePeakDb: -1.5 },
          transcriptExcerpt: [],
        },
        catalog: { templates: [], luts: [], music: [], fonts: [] },
        strictLlm: true,
      };

      await expect(adapter.generateEditPlan(input)).rejects.toThrow(AppError);

      try {
        await adapter.generateEditPlan(input);
      } catch (err: any) {
        expect(err.statusCode).toBe(502);
        expect(err.code).toBe('UPSTREAM_LLM_UNAVAILABLE');
      }
    });
  });

  describe('3. MetricsService Observability & Alerting', () => {
    it('tracks primary, fallback model, and heuristic executions', () => {
      MetricsService.recordPlannerExecution({
        provider: 'gemini',
        requestedModel: 'gemini-3.5-flash',
        actualModel: 'gemini-3.5-flash',
        executionMode: 'primary_llm',
        isFallback: false,
      });

      MetricsService.recordPlannerExecution({
        provider: 'gemini',
        requestedModel: 'gemini-3.5-flash',
        actualModel: 'gemini-3.5-flash-lite',
        executionMode: 'fallback_llm',
        isFallback: true,
        fallbackReason: 'Primary unavailable',
      });

      MetricsService.recordPlannerExecution({
        provider: 'gemini',
        requestedModel: 'gemini-3.5-flash',
        actualModel: 'rule-engine-v1',
        executionMode: 'heuristic_fallback',
        isFallback: true,
        fallbackReason: 'API key exhausted',
      });
    });

    it('triggers UPSTREAM_LLM_DEGRADED alert after 3 consecutive heuristic fallbacks', () => {
      for (let i = 0; i < 3; i++) {
        MetricsService.recordPlannerExecution({
          provider: 'gemini',
          requestedModel: 'gemini-3.5-flash',
          actualModel: 'rule-engine-v1',
          executionMode: 'heuristic_fallback',
          isFallback: true,
          fallbackReason: 'Network timeout',
        });
      }

      const planner = MetricsService.getPlannerSummary();
      expect(planner.heuristic).toBe(3);
      expect(planner.consecutiveHeuristic).toBe(3);

      const alerts = MetricsService.getRecentAlerts();
      const alert = alerts.find((a) => a.alertType === 'UPSTREAM_LLM_DEGRADED');
      expect(alert).toBeDefined();
      expect(alert?.severity).toBe('warning');
      expect(alert?.message).toContain('Upstream LLM unavailable or failing');
    });

    it('resets consecutive heuristic counter upon successful primary LLM plan', () => {
      for (let i = 0; i < 2; i++) {
        MetricsService.recordPlannerExecution({
          provider: 'gemini',
          requestedModel: 'gemini-3.5-flash',
          actualModel: 'rule-engine-v1',
          executionMode: 'heuristic_fallback',
          isFallback: true,
          fallbackReason: 'Network timeout',
        });
      }

      // Recovery event
      MetricsService.recordPlannerExecution({
        provider: 'gemini',
        requestedModel: 'gemini-3.5-flash',
        actualModel: 'gemini-3.5-flash',
        executionMode: 'primary_llm',
        isFallback: false,
      });

      const planner = MetricsService.getPlannerSummary();
      expect(planner.consecutiveHeuristic).toBe(0);
      expect(planner.primary).toBe(1);
    });
  });

  describe('4. PlannerService End-to-End Fallback Propagation', () => {
    it('propagates executionMode and fallback telemetry into generated EditPlan meta', async () => {
      const mockHeuristicAdapter: PlannerProvider = {
        async generateEditPlan(): Promise<PlannerProviderOutput> {
          return {
            provider: 'gemini',
            model: 'rule-engine-v1',
            executionMode: 'heuristic_fallback',
            isFallback: true,
            requestedModel: 'gemini-pro',
            fallbackReason: 'Rate limit 429',
            structuredOutput: {
              schemaVersion: '1.0',
              projectId: 'prj_1',
              baseAssetId: 'ast_1',
              version: 1,
              global: { aspect: '16:9', fps: 30, resolution: '1080p' },
              layers: [
                {
                  id: 'lyr_c1',
                  layer: 'color',
                  enabled: true,
                  timebase: 'global',
                  params: { preset: 'cinematic', brightness: 0, contrast: 1, saturation: 1 },
                },
              ],
              meta: {
                prompt: 'Make it cinematic',
                model: 'rule-engine-v1',
                createdAt: new Date().toISOString(),
              },
            },
          };
        },
      };

      const planner = new PlannerService(mockHeuristicAdapter);
      const result = await planner.plan(
        'Make it cinematic',
        'prj_1',
        'ast_1',
        0,
        {
          durationMs: 30000,
          width: 1920,
          height: 1080,
          fps: 30,
          silences: [],
          sceneCuts: [],
          beats: { bpm: 120, grid: [] },
          loudness: { integratedLufs: -16, truePeakDb: -1.5 },
          transcriptExcerpt: [],
        },
        { templates: [], luts: [{ id: 'cinematic', name: 'Cinematic' }], music: [], fonts: [] }
      );

      expect(result.executionMode).toBe('heuristic_fallback');
      expect(result.isFallback).toBe(true);
      expect(result.requestedModel).toBe('gemini-pro');
      expect(result.fallbackReason).toBe('Rate limit 429');
      expect(result.plan.meta.executionMode).toBe('heuristic_fallback');
      expect(result.plan.meta.isFallback).toBe(true);
      expect(result.plan.meta.fallbackReason).toBe('Rate limit 429');
    });
  });
});
