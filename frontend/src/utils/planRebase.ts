import { compare, applyPatch, Operation } from 'fast-json-patch';
import { EditPlan } from '@ai-video/shared';

export interface RebaseResult {
  success: boolean;
  rebasedPlan?: EditPlan;
  rebasedPatch?: Operation[];
  error?: string;
}

/**
 * Optimistically rebases local draft edits (relative to an older base plan)
 * onto a newer server head plan using RFC 6902 JSON Patch transformation.
 *
 * @param basePlan - The plan version the user started editing from
 * @param draftPlan - The user's current local working copy with uncommitted edits
 * @param headPlan - The latest plan version retrieved from the server
 * @returns RebaseResult indicating whether the rebase was clean and providing the transformed patch
 */
export function rebasePlanPatch(
  basePlan: EditPlan,
  draftPlan: EditPlan,
  headPlan: EditPlan
): RebaseResult {
  try {
    const localPatch = compare(basePlan, draftPlan);
    if (!localPatch || localPatch.length === 0) {
      return { success: true, rebasedPlan: headPlan, rebasedPatch: [] };
    }

    const rebasedCandidate = JSON.parse(JSON.stringify(headPlan));
    // Apply local operations onto the new head candidate.
    // validateOperation = false, banPrototypes = true to prevent prototype poisoning
    applyPatch(rebasedCandidate, localPatch, false, true);

    const rebasedPatch = compare(headPlan, rebasedCandidate);
    return {
      success: true,
      rebasedPlan: rebasedCandidate,
      rebasedPatch,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Conflict detected during patch rebase',
    };
  }
}
