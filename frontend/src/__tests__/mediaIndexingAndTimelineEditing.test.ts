import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMediaIndex,
  searchMediaIndex,
  renameSpeakerInCues,
  cleanEmptyCues,
  getSpeakerColor,
} from '@ai-video/shared';
import { useEditorStore, selectEffectivePlan } from '../stores/editorStore';

describe('Media Indexing & Direct Timeline Editing Suite', () => {
  const sampleCues = [
    {
      id: 'cue_1',
      startMs: 0,
      endMs: 3000,
      text: 'Hello, welcome to this product demonstration video.',
      speaker: 'Speaker 1',
      words: [
        { word: 'Hello,', startMs: 0, endMs: 500, score: 0.99 },
        { word: 'welcome', startMs: 500, endMs: 1200, score: 0.98 },
        { word: 'to', startMs: 1200, endMs: 1500, score: 0.99 },
        { word: 'this', startMs: 1500, endMs: 1800, score: 0.99 },
        { word: 'product', startMs: 1800, endMs: 2200, score: 0.95 },
        { word: 'demonstration', startMs: 2200, endMs: 2800, score: 0.97 },
        { word: 'video.', startMs: 2800, endMs: 3000, score: 0.99 },
      ],
    },
    {
      id: 'cue_2',
      startMs: 3500,
      endMs: 6500,
      text: 'Thanks, I am happy to join the walkthrough.',
      speaker: 'Speaker 2',
      words: [
        { word: 'Thanks,', startMs: 3500, endMs: 4000, score: 0.98 },
        { word: 'I', startMs: 4000, endMs: 4200, score: 0.99 },
        { word: 'am', startMs: 4200, endMs: 4400, score: 0.99 },
        { word: 'happy', startMs: 4400, endMs: 4800, score: 0.98 },
        { word: 'to', startMs: 4800, endMs: 5000, score: 0.99 },
        { word: 'join', startMs: 5000, endMs: 5400, score: 0.97 },
        { word: 'the', startMs: 5400, endMs: 5600, score: 0.99 },
        { word: 'walkthrough.', startMs: 5600, endMs: 6500, score: 0.98 },
      ],
    },
    {
      id: 'cue_3',
      startMs: 7000,
      endMs: 8000,
      text: '   ""   ',
      speaker: 'Speaker 1',
    },
    {
      id: 'cue_4',
      startMs: 8500,
      endMs: 11000,
      text: 'Let us dive straight into the editing timeline.',
      speaker: 'Speaker 1',
    },
  ];

  const sampleSceneCuts = [4.5, 9.0];

  describe('1. Multimodal Indexing Engine', () => {
    it('builds continuous scene intervals correlating cues and speakers', () => {
      const index = buildMediaIndex(sampleCues as any, sampleSceneCuts, 15);

      expect(index.totalDurationMs).toBe(15000);
      expect(index.scenes.length).toBe(3); // [0, 4.5], [4.5, 9.0], [9.0, 15.0]

      // Scene 1: [0, 4.5s] includes cue_1 and cue_2
      expect(index.scenes[0].index).toBe(1);
      expect(index.scenes[0].startSec).toBe(0);
      expect(index.scenes[0].endSec).toBe(4.5);
      expect(index.scenes[0].speakers).toContain('Speaker 1');
      expect(index.scenes[0].speakers).toContain('Speaker 2');

      // Scene 2: [4.5, 9.0s] includes cue_2, cue_3, and cue_4
      expect(index.scenes[1].index).toBe(2);
      expect(index.scenes[1].startSec).toBe(4.5);
      expect(index.scenes[1].endSec).toBe(9.0);
    });

    it('aggregates speaker statistics and dialogue percentages', () => {
      const index = buildMediaIndex(sampleCues as any, sampleSceneCuts, 15);

      expect(index.speakers.length).toBe(2);
      const spk1 = index.speakers.find((s) => s.id === 'Speaker 1');
      const spk2 = index.speakers.find((s) => s.id === 'Speaker 2');

      expect(spk1).toBeDefined();
      expect(spk2).toBeDefined();
      expect(spk1!.cuesCount).toBe(3);
      expect(spk2!.cuesCount).toBe(1);
      expect(spk1!.totalSpeakingMs).toBe(6500); // 3000 + 1000 + 2500
      expect(spk2!.totalSpeakingMs).toBe(3000);
      expect(spk1!.percentageOfDialogue + spk2!.percentageOfDialogue).toBeCloseTo(100, 0);
      expect(index.speakerTurnCount).toBeGreaterThan(0);
    });

    it('searches media index by text query and speaker filter', () => {
      const index = buildMediaIndex(sampleCues as any, sampleSceneCuts, 15);

      const searchWalkthrough = searchMediaIndex(index, { query: 'walkthrough' });
      expect(searchWalkthrough.length).toBe(1);
      expect(searchWalkthrough[0].id).toBe('cue_2');

      const searchSpeaker1 = searchMediaIndex(index, { speakerId: 'Speaker 1' });
      expect(searchSpeaker1.length).toBe(3);

      const searchInScene1 = searchMediaIndex(index, { sceneIndex: 1 });
      expect(searchInScene1.length).toBe(2);
    });

    it('cleans empty and whitespace-only cues', () => {
      const cleaned = cleanEmptyCues(sampleCues as any);
      expect(cleaned.length).toBe(3);
      expect(cleaned.some((c) => c.id === 'cue_3')).toBe(false);
    });

    it('renames speaker across all cues atomically', () => {
      const renamed = renameSpeakerInCues(sampleCues as any, 'Speaker 1', 'Alex Rivera');
      expect(renamed.filter((c) => c.speaker === 'Alex Rivera').length).toBe(3);
      expect(renamed.filter((c) => c.speaker === 'Speaker 2').length).toBe(1);
    });

    it('generates consistent speaker colors', () => {
      const color1 = getSpeakerColor('Speaker 1');
      const color2 = getSpeakerColor('Speaker 2');
      const color1Again = getSpeakerColor('Speaker 1');
      expect(color1).toBe(color1Again);
      expect(color1).not.toBe(color2);
    });
  });

  describe('2. Direct Timeline Manipulation Store Actions', () => {
    beforeEach(() => {
      useEditorStore.setState({
        project: {
          id: 'proj_test_123',
          title: 'Test Timeline Project',
          status: 'ready',
          assetId: 'asset_1',
          durationSec: 15,
          headVersion: 1,
          aspect: '16:9',
          fps: 30,
          resolution: '1080p',
          media: { durationMs: 15000, width: 1920, height: 1080, fps: 30 },
          analysisSummary: {
            durationMs: 15000,
            silencesCount: 1,
            sceneCutsCount: 2,
            bpm: 120,
            integratedLufs: -14,
            sceneCuts: [4.5, 9.0],
            cues: JSON.parse(JSON.stringify(sampleCues)),
            cuesCount: 4,
          } as any,
        },
        playback: {
          status: 'idle',
          currentTime: 2.5,
          duration: 15,
          rate: 1,
          volume: 1,
          muted: false,
        },
        timeline: {
          zoom: 60,
          scrollX: 0,
          selectedLayerIds: [],
          snap: true,
          toolMode: 'select',
        },
        plan: {
          current: {
            version: 1,
            global: { aspect: '16:9', fps: 30, resolution: '1080p' },
            layers: [
              {
                id: 'l_color_1',
                layer: 'color',
                enabled: true,
                timebase: 'global',
                params: { preset: 'cinematic', contrast: 1, saturation: 1 },
              },
              {
                id: 'l_text_1',
                layer: 'text',
                enabled: true,
                timebase: 'source',
                range: { start: 1.0, end: 10.0 },
                params: { content: 'Intro Title', position: { x: 0.5, y: 0.5 }, animation: 'fade' },
              },
            ],
          },
          draft: null,
          version: 1,
          history: [1],
          cursor: 0,
          versionMap: {},
        },
      });
    });

    it('toggles toolMode between select and razor cut modes', () => {
      expect(useEditorStore.getState().timeline.toolMode).toBe('select');
      useEditorStore.getState().setToolMode('razor');
      expect(useEditorStore.getState().timeline.toolMode).toBe('razor');
      useEditorStore.getState().setToolMode('select');
      expect(useEditorStore.getState().timeline.toolMode).toBe('select');
    });

    it('splits subtitle cue at playhead without modifying color grade layer', () => {
      useEditorStore.setState((state) => {
        state.playback.currentTime = 1.5;
        state.timeline.selectedLayerIds = ['cue_1'];
      });

      const success = useEditorStore.getState().splitLayerAtTime(1.5, 'cue_1');
      expect(success).toBe(true);

      const cues = useEditorStore.getState().project?.analysisSummary?.cues || [];
      expect(cues.length).toBe(5); // Originally 4 cues + 1 split
      expect(cues[0].endMs).toBe(1500);
      expect(cues[1].startMs).toBe(1530);

      // Verify color grade layer was NOT touched or split
      const effectivePlan = selectEffectivePlan(useEditorStore.getState());
      const colorLayers = effectivePlan?.layers.filter((l) => l.layer === 'color') || [];
      expect(colorLayers.length).toBe(1);
    });

    it('cleans empty subtitle cues via store action', () => {
      const removed = useEditorStore.getState().cleanEmptySubtitleCues();
      expect(removed).toBe(1);

      const remainingCues = useEditorStore.getState().project?.analysisSummary?.cues || [];
      expect(remainingCues.length).toBe(3);
      expect(remainingCues.some((c) => c.id === 'cue_3')).toBe(false);
    });

    it('renames speaker across all cues in project store', () => {
      useEditorStore.getState().renameSpeaker('Speaker 1', 'Jordan Miles');
      const updatedCues = useEditorStore.getState().project?.analysisSummary?.cues || [];
      const jordanCues = updatedCues.filter((c) => c.speaker === 'Jordan Miles');
      expect(jordanCues.length).toBe(3);
    });

    it('deletes selected subtitle cues cleanly when deleteSelectedLayers is invoked', () => {
      useEditorStore.setState((state) => {
        state.timeline.selectedLayerIds = ['cue_1'];
      });

      useEditorStore.getState().deleteSelectedLayers();
      const cues = useEditorStore.getState().project?.analysisSummary?.cues || [];
      expect(cues.length).toBe(3);
      expect(cues.some((c) => c.id === 'cue_1')).toBe(false);
      expect(useEditorStore.getState().timeline.selectedLayerIds).toEqual([]);
    });

    it('splits timeline text layer cleanly when explicitly selected', () => {
      useEditorStore.setState((state) => {
        state.timeline.selectedLayerIds = ['l_text_1'];
      });

      const splitSuccess = useEditorStore.getState().splitLayerAtTime(5.0, 'l_text_1');
      expect(splitSuccess).toBe(true);

      const layers = useEditorStore.getState().plan.draft?.layers || [];
      const textLayers = layers.filter((l) => l.layer === 'text');
      expect(textLayers.length).toBe(2);
      expect(textLayers[0].range?.end).toBe(5.0);
      expect(textLayers[1].range?.start).toBe(5.0);
    });
  });
});
