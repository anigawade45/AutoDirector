import fastJsonPatch, { Operation } from 'fast-json-patch';
import { EditPlan } from '@ai-video/shared';

export type PatchOperation = Operation;

export class PatchEngine {
  /**
   * Normalizes and applies RFC 6902 patch operations to an existing EditPlan.
   * Supports standard array indices (/layers/0/...), layer ID paths (/layers/lyr_s1/...),
   * and auto-maps top-level global settings (e.g., /global/colorGrading) to EditPlan layers.
   */
  static apply(
    currentPlan: EditPlan,
    rawPatches: PatchOperation[]
  ): { patchedPlan: any; normalizedPatches: PatchOperation[] } {
    if (!Array.isArray(rawPatches)) {
      throw new Error('Patch must be an array of RFC 6902 operations');
    }

    const clonedPlan = JSON.parse(JSON.stringify(currentPlan));
    clonedPlan.layers = Array.isArray(clonedPlan.layers) ? clonedPlan.layers : [];
    const normalizedPatches: PatchOperation[] = [];

    if (rawPatches.length === 0) {
      return { patchedPlan: clonedPlan, normalizedPatches: [] };
    }

    for (const p of rawPatches) {
      if (!p || typeof p !== 'object' || !p.op || !p.path) {
        continue;
      }

      let opType: any = p.op;
      let normalizedPath = p.path;
      let patchValue = (p as any).value;

      // 1. Intercept top-level /global/colorGrading, /global/preset, /global/lut
      if (
        p.path.startsWith('/global/colorGrading') ||
        p.path.startsWith('/global/color') ||
        p.path.startsWith('/global/preset') ||
        p.path.startsWith('/global/lut')
      ) {
        let colorLayerIndex = clonedPlan.layers.findIndex((l: any) => l.layer === 'color');
        if (colorLayerIndex === -1) {
          const newColorLayer = {
            id: 'lyr_color_1',
            layer: 'color',
            enabled: true,
            timebase: 'global',
            params: {
              preset: 'cinematic',
              lut: 'teal_orange',
              contrast: 1.15,
              saturation: 1.2,
              brightness: 0,
            },
          };
          clonedPlan.layers.push(newColorLayer);
          colorLayerIndex = clonedPlan.layers.length - 1;
        }

        const existingParams = clonedPlan.layers[colorLayerIndex].params || {};
        if (p.path.includes('preset') && typeof patchValue === 'string') {
          existingParams.preset = patchValue;
        } else if (p.path.includes('lut') && typeof patchValue === 'string') {
          existingParams.lut = patchValue;
        } else if (patchValue && typeof patchValue === 'object') {
          Object.assign(existingParams, patchValue);
        }
        clonedPlan.layers[colorLayerIndex].params = existingParams;
        continue;
      }

      // 2. Pre-normalize layer objects in patch value
      if (patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue)) {
        patchValue = { ...patchValue };
        const rawType = String(patchValue.layer || '').toLowerCase();
        if (['subtitles', 'captions', 'caption', 'subs'].includes(rawType)) {
          patchValue.layer = 'subtitle';
        } else if (
          ['color', 'color_grade', 'colorgrading', 'colour', 'lut', 'filter', 'global'].includes(
            rawType
          )
        ) {
          patchValue.layer = 'color';
        } else if (['cut', 'cuts', 'trim', 'trims', 'source', 'clip'].includes(rawType)) {
          patchValue.layer = 'cut';
        } else if (['music', 'bgm', 'soundtrack', 'song'].includes(rawType)) {
          patchValue.layer = 'music';
        }

        // Unnest color params if nested
        if (patchValue.layer === 'color' && patchValue.params?.color) {
          patchValue.params = { ...patchValue.params, ...patchValue.params.color };
        }

        // Normalize cut range if sourceIn / sourceOut or start / end in params
        if (patchValue.layer === 'cut' && !patchValue.range) {
          const s =
            patchValue.params?.sourceIn ?? patchValue.params?.start ?? patchValue.start ?? 0;
          const e = patchValue.params?.sourceOut ?? patchValue.params?.end ?? patchValue.end ?? 10;
          patchValue.range = { start: Number(s), end: Number(e) };
          patchValue.timebase = 'source';
        }

        // Normalize subtitle params
        if (patchValue.layer === 'subtitle' && patchValue.params) {
          if (patchValue.params.style === 'word-pop') patchValue.params.style = 'word_pop';
          if (patchValue.params.fontSize && !patchValue.params.size)
            patchValue.params.size = patchValue.params.fontSize;
          if (patchValue.params.color && !patchValue.params.primaryColor)
            patchValue.params.primaryColor = patchValue.params.color;
        }
      }

      // 3. Handle layer ID referencing in path: /layers/{layerId}/... or /layers/{layerId}
      const layerIdMatch = p.path.match(/^\/layers\/([a-zA-Z0-9_-]+)(\/.*)?$/);
      if (layerIdMatch) {
        const targetIdOrIndex = layerIdMatch[1];
        const subPath = layerIdMatch[2] || '';

        // If it's not a numeric index and not '-'
        if (!/^\d+$/.test(targetIdOrIndex) && targetIdOrIndex !== '-') {
          // Find index by exact id
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
            // Target layer does not exist; convert to add
            normalizedPath = '/layers/-';
            opType = 'add';
          }
        }
      }

      normalizedPatches.push({
        op: opType,
        path: normalizedPath,
        value: patchValue,
      } as Operation);
    }

    // Apply the normalized patch operations safely
    for (const op of normalizedPatches) {
      try {
        fastJsonPatch.applyOperation(clonedPlan, op, true, true);
      } catch (patchErr: any) {
        console.warn(
          `[PatchEngine] Ignored non-critical patch error (${op.op} ${op.path}):`,
          patchErr.message
        );
      }
    }

    return {
      patchedPlan: clonedPlan,
      normalizedPatches,
    };
  }
}
