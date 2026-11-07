import { EditPlan, EditPlanSchema, CompactAnalysisSummary, validateEditPlan } from '@ai-video/shared';
import { PlannerProvider, AllowedCatalog } from './plannerProvider.interface.js';
import { GeminiPlannerAdapter } from './geminiAdapter.js';
import { OpenAIPlannerAdapter } from './openaiAdapter.js';
import { ContextBuilder } from './contextBuilder.js';
import { PlanNormalizer } from './planNormalizer.js';
import { PatchEngine, PatchOperation } from './patchEngine.js';
import { AppError } from '../../middleware/errorHandler.js';
import { env } from '../../config/env.js';

export interface PlanGenerationResult {
  plan: EditPlan;
  tokensIn?: number;
  tokensOut?: number;
  repairAttempts: number;
  patch?: PatchOperation[];
}

export class PlannerService {
  private adapter: PlannerProvider;

  constructor(customAdapter?: PlannerProvider) {
    if (customAdapter) {
      this.adapter = customAdapter;
    } else if (env.AI_PROVIDER === 'openai') {
      this.adapter = new OpenAIPlannerAdapter();
    } else {
      this.adapter = new GeminiPlannerAdapter();
    }
  }

  async plan(
    userPrompt: string,
    projectId: string,
    baseAssetId: string,
    currentVersion: number,
    analysis: CompactAnalysisSummary,
    catalog: AllowedCatalog,
    currentPlan?: EditPlan
  ): Promise<PlanGenerationResult> {
    const systemInstructions = ContextBuilder.buildSystemInstructions();
    const userContext = ContextBuilder.buildUserContext(
      userPrompt,
      projectId,
      baseAssetId,
      currentVersion,
      analysis,
      catalog,
      currentPlan
    );

    const assetDurationSec = (analysis.durationMs || 60000) / 1000;
    let attempts = 0;
    let repairAttempts = 0;
    let lastZodError: any = null;
    let lastGeneralError: any = null;
    let currentInput = userContext;

    while (attempts < 2) {
      attempts++;
      try {
        const result = await this.adapter.generateEditPlan({
          systemInstructions,
          userPrompt: currentInput,
          currentPlan,
          analysisSummary: analysis,
          catalog,
        });

        const rawOutput: any = result.structuredOutput;
        let candidatePlan: any;
        let appliedPatch: PatchOperation[] | undefined = undefined;

        // Check if output is an RFC 6902 patch
        if (rawOutput && Array.isArray(rawOutput.patch) && currentPlan) {
          const patchResult = PatchEngine.apply(currentPlan, rawOutput.patch);
          candidatePlan = patchResult.patchedPlan;
          candidatePlan.version = currentVersion + 1;
          candidatePlan.parentVersion = currentVersion;
          candidatePlan.meta = {
            ...(candidatePlan.meta || {}),
            prompt: userPrompt,
            model: result.model,
            createdAt: new Date().toISOString(),
          };
          appliedPatch = patchResult.normalizedPatches;
        } else {
          candidatePlan = rawOutput;
          if (candidatePlan && typeof candidatePlan === 'object') {
            candidatePlan.projectId = projectId;
            candidatePlan.baseAssetId = baseAssetId;
            candidatePlan.version = currentVersion + 1;
            candidatePlan.parentVersion = currentPlan?.version ?? null;
            candidatePlan.meta = {
              ...(candidatePlan.meta || {}),
              prompt: userPrompt,
              model: result.model,
              createdAt: new Date().toISOString(),
            };
          }
        }

        // Apply parameter clamping, catalog reference resolution, time sanity, cut merging, beat snapping & budgets
        const normalizedPlan = PlanNormalizer.normalize(candidatePlan, {
          assetDurationSec,
          catalog,
          prompt: userPrompt,
          beats: analysis.beats,
        });

        // Validate strictly with Zod discriminated union
        const parseResult = EditPlanSchema.safeParse(normalizedPlan);

        if (parseResult.success) {
          const validated = parseResult.data as EditPlan;
          const semanticValidation = validateEditPlan(validated, {
            assetDurationSec,
            fps: validated.global?.fps || 30,
          });

          if (semanticValidation.valid) {
            return {
              plan: validated,
              tokensIn: result.usage?.inputTokens,
              tokensOut: result.usage?.outputTokens,
              repairAttempts,
              patch: appliedPatch,
            };
          }

          // Semantic timeline invariants failed - prepare repair retry
          repairAttempts++;
          currentInput = `${userContext}\n\nPREVIOUS PLAN VIOLATED TIMELINE INVARIANTS:\n${semanticValidation.errors.join(
            '\n'
          )}\nPlease repair the edit plan to satisfy all timeline invariants.`;
          continue;
        }

        // Schema validation failed - prepare repair retry
        repairAttempts++;
        lastZodError = parseResult.error;

        currentInput = `${userContext}\n\nPREVIOUS OUTPUT WAS INVALID JSON SCHEMA:\n${JSON.stringify(
          parseResult.error.errors,
          null,
          2
        )}\nPlease repair the output to strictly adhere to the required EditPlan schema.`;
      } catch (err: any) {
        lastGeneralError = err;
      }
    }

    // Both attempts failed: reject with clear 422 semantic validation failure per API Contract §2.1 & §7.2
    throw new AppError(
      422,
      'PLAN_VALIDATION_ERROR',
      `Plan generation failed validation after repair attempt: ${
        lastZodError?.message || lastGeneralError?.message || 'Invalid plan format'
      }`,
      lastZodError?.errors || []
    );
  }
}
