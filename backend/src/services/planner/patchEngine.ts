import fastJsonPatch, { Operation } from 'fast-json-patch';
import { EditPlan } from '@ai-video/shared';

export type PatchOperation = Operation;

export class PatchEngine {
  /**
   * Normalizes and applies RFC 6902 patch operations to an existing EditPlan.
   * Supports both standard array indices (/layers/0/...) and layer ID paths
   * (/layers/lyr_s1/...) as specified in Functional Specification §3.6.
   */
  static apply(
    currentPlan: EditPlan,
    rawPatches: PatchOperation[]
  ): { patchedPlan: any; normalizedPatches: PatchOperation[] } {
    if (!Array.isArray(rawPatches) || rawPatches.length === 0) {
      throw new Error('Patch must be a non-empty array of RFC 6902 operations');
    }

    const clonedPlan = JSON.parse(JSON.stringify(currentPlan));
    const normalizedPatches: PatchOperation[] = [];

    for (const p of rawPatches) {
      if (!p || typeof p !== 'object' || !p.op || !p.path) {
        continue;
      }

      let normalizedPath = p.path;

      // Handle layer ID referencing in path: /layers/{layerId}/... or /layers/{layerId}
      const layerIdMatch = p.path.match(/^\/layers\/([a-zA-Z0-9_-]+)(\/.*)?$/);
      if (layerIdMatch) {
        const targetIdOrIndex = layerIdMatch[1];
        const subPath = layerIdMatch[2] || '';

        // If it's not a numeric index and not '-'
        if (!/^\d+$/.test(targetIdOrIndex) && targetIdOrIndex !== '-') {
          // Find index by id
          let foundIndex = clonedPlan.layers.findIndex((l: any) => l.id === targetIdOrIndex);

          // If not found by exact ID, try heuristic matching by layer type in id (e.g., 'sub', 'col', 'mus')
          if (foundIndex === -1) {
            const idLower = targetIdOrIndex.toLowerCase();
            if (idLower.includes('sub') || idLower.includes('caption')) {
              foundIndex = clonedPlan.layers.findIndex((l: any) => l.layer === 'subtitle');
            } else if (idLower.includes('col') || idLower.includes('lut')) {
              foundIndex = clonedPlan.layers.findIndex((l: any) => l.layer === 'color');
            } else if (idLower.includes('mus') || idLower.includes('aud')) {
              foundIndex = clonedPlan.layers.findIndex((l: any) => l.layer === 'music');
            } else if (idLower.includes('spd')) {
              foundIndex = clonedPlan.layers.findIndex((l: any) => l.layer === 'speed');
            } else if (idLower.includes('intro')) {
              foundIndex = clonedPlan.layers.findIndex((l: any) => l.layer === 'intro');
            } else if (idLower.includes('trans')) {
              foundIndex = clonedPlan.layers.findIndex((l: any) => l.layer === 'transition');
            }
          }

          if (foundIndex !== -1) {
            normalizedPath = `/layers/${foundIndex}${subPath}`;
          } else if (p.op === 'add') {
            normalizedPath = `/layers/-${subPath}`;
          } else if (p.op === 'remove') {
            // Target layer already does not exist; safely skip removing it
            continue;
          } else if (p.op === 'replace') {
            // Target layer does not exist; if modifying music/color/subtitle, convert to adding layer
            const idLower = targetIdOrIndex.toLowerCase();
            if (idLower.includes('mus')) {
              normalizedPatches.push({
                op: 'add',
                path: '/layers/-',
                value: {
                  id: 'lyr_mus_new',
                  layer: 'music',
                  enabled: true,
                  timebase: 'output',
                  params: {
                    trackId: 'tpl_lofi_beat',
                    volume: typeof (p as any).value === 'number' ? (p as any).value : 0.25,
                    duckUnderSpeech: true,
                  },
                },
              } as Operation);
              continue;
            } else if (idLower.includes('col')) {
              normalizedPatches.push({
                op: 'add',
                path: '/layers/-',
                value: {
                  id: 'lyr_col_new',
                  layer: 'color',
                  enabled: true,
                  timebase: 'global',
                  params: { preset: 'warm', contrast: 1.1, saturation: 1.0 },
                },
              } as Operation);
              continue;
            } else {
              // Cannot replace non-existent path
              continue;
            }
          }
        }
      }

      normalizedPatches.push({
        op: p.op,
        path: normalizedPath,
        value: (p as any).value,
      } as Operation);
    }

    // Apply the normalized patch operations with mutateDocument: true
    const result = fastJsonPatch.applyPatch(clonedPlan, normalizedPatches, true, true);

    if (result.newDocument) {
      return {
        patchedPlan: result.newDocument,
        normalizedPatches,
      };
    }

    return {
      patchedPlan: clonedPlan,
      normalizedPatches,
    };
  }
}
