import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore } from '../stores/editorStore';
import { api } from '../api/client';
import { EditPlan } from '@ai-video/shared';

vi.mock('../api/client', () => ({
  api: {
    listPlanVersions: vi.fn(),
    revertPlan: vi.fn(),
  },
}));

describe('Version History & Undo Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store state
    const store = useEditorStore.getState();
    store.project = {
      id: 'prj_undo_test',
      title: 'Undo Test Project',
      headVersion: 1,
    } as any;
    store.plan = {
      current: null,
      draft: null,
      version: 1,
      history: [1],
      cursor: 0,
      versionMap: {},
    };
    store.preview = {
      url: 'https://cdn.example.com/proxy_v1.mp4',
      baseProxyUrl: 'https://cdn.example.com/base_raw.mp4',
      versionUrlMap: { 1: 'https://cdn.example.com/proxy_v1.mp4' },
      planVersion: 1,
      isRendered: true,
      stale: false,
    };
  });

  it('updates plan history and versionMap when new plan versions are committed', () => {
    const store = useEditorStore.getState();

    const planV1: EditPlan = {
      schemaVersion: '1.0',
      projectId: 'prj_undo_test',
      baseAssetId: 'ast_base',
      version: 1,
      parentVersion: null,
      global: { aspect: '16:9', fps: 30, resolution: '1080p' },
      layers: [],
    };

    const planV2: EditPlan = {
      ...planV1,
      version: 2,
      parentVersion: 1,
      layers: [
        {
          id: 'lyr_color_v2',
          layer: 'color',
          enabled: true,
          timebase: 'global',
          params: { contrast: 1.2, saturation: 1.1 },
        },
      ],
    };

    store.setPlan(planV1);
    store.setPreviewUrl('https://cdn.example.com/proxy_v1.mp4', 1, true);

    store.setPlan(planV2);
    store.setPreviewUrl('https://cdn.example.com/proxy_v2.mp4', 2, true);

    const state = useEditorStore.getState();
    expect(state.plan.version).toBe(2);
    expect(state.plan.history).toEqual([1, 2]);
    expect(state.plan.cursor).toBe(1);
    expect(state.plan.versionMap[2].layers).toHaveLength(1);
  });

  it('rolls back to prior version and switches preview proxy URL seamlessly on undo()', () => {
    const store = useEditorStore.getState();

    const planV1: EditPlan = {
      schemaVersion: '1.0',
      projectId: 'prj_undo_test',
      baseAssetId: 'ast_base',
      version: 1,
      parentVersion: null,
      global: { aspect: '16:9', fps: 30, resolution: '1080p' },
      layers: [],
    };

    const planV2: EditPlan = {
      ...planV1,
      version: 2,
      parentVersion: 1,
      layers: [
        {
          id: 'lyr_color_v2',
          layer: 'color',
          enabled: true,
          timebase: 'global',
          params: { contrast: 1.2, saturation: 1.1 },
        },
      ],
    };

    store.setPlan(planV1);
    store.setPreviewUrl('https://cdn.example.com/proxy_v1.mp4', 1, true);
    store.setPlan(planV2);
    store.setPreviewUrl('https://cdn.example.com/proxy_v2.mp4', 2, true);

    // Call Undo
    store.undo();

    const undoneState = useEditorStore.getState();
    expect(undoneState.plan.version).toBe(1);
    expect(undoneState.plan.cursor).toBe(0);
    expect(undoneState.preview.url).toBe('https://cdn.example.com/proxy_v1.mp4');
    expect(undoneState.preview.planVersion).toBe(1);
  });

  it('restores next version and preview proxy URL on redo()', () => {
    const store = useEditorStore.getState();

    const planV1: EditPlan = {
      schemaVersion: '1.0',
      projectId: 'prj_undo_test',
      baseAssetId: 'ast_base',
      version: 1,
      parentVersion: null,
      global: { aspect: '16:9', fps: 30, resolution: '1080p' },
      layers: [],
    };

    const planV2: EditPlan = {
      ...planV1,
      version: 2,
      parentVersion: 1,
      layers: [],
    };

    store.setPlan(planV1);
    store.setPreviewUrl('https://cdn.example.com/proxy_v1.mp4', 1, true);
    store.setPlan(planV2);
    store.setPreviewUrl('https://cdn.example.com/proxy_v2.mp4', 2, true);

    store.undo();
    expect(useEditorStore.getState().plan.version).toBe(1);

    store.redo();
    const redoneState = useEditorStore.getState();
    expect(redoneState.plan.version).toBe(2);
    expect(redoneState.plan.cursor).toBe(1);
    expect(redoneState.preview.url).toBe('https://cdn.example.com/proxy_v2.mp4');
  });

  it('queries plan versions list and invokes revertPlan API', async () => {
    (api.listPlanVersions as any).mockResolvedValue({
      data: {
        headVersion: 3,
        versions: [
          { version: 3, isCurrent: true, prompt: 'Add music', layersCount: 2 },
          { version: 2, isCurrent: false, prompt: 'Cut silences', layersCount: 1 },
          { version: 1, isCurrent: false, prompt: 'Initial', layersCount: 0 },
        ],
      },
    });

    const res = await api.listPlanVersions('prj_undo_test');
    expect(api.listPlanVersions).toHaveBeenCalledWith('prj_undo_test');
    expect(res.data.versions).toHaveLength(3);

    (api.revertPlan as any).mockResolvedValue({
      data: {
        version: 4,
        parentVersion: 3,
        restoredFromVersion: 2,
        plan: {
          schemaVersion: '1.0',
          projectId: 'prj_undo_test',
          baseAssetId: 'ast_base',
          version: 4,
          parentVersion: 3,
          global: { aspect: '16:9', fps: 30, resolution: '1080p' },
          layers: [],
        },
      },
    });

    const revertRes = await api.revertPlan('prj_undo_test', 2);
    expect(api.revertPlan).toHaveBeenCalledWith('prj_undo_test', 2);
    expect(revertRes.data.version).toBe(4);
    expect(revertRes.data.restoredFromVersion).toBe(2);
  });
});
