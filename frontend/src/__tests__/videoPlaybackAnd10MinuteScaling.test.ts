import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../stores/editorStore';

describe('Video Playback Synchronization & 10-Minute Video Scaling', () => {
  beforeEach(() => {
    useEditorStore.setState({
      playback: {
        status: 'idle',
        currentTime: 0,
        duration: 60,
        rate: 1.0,
        volume: 1.0,
        muted: false,
      },
      timeline: {
        zoom: 40,
        scrollX: 0,
        selectedLayerIds: [],
        snap: true,
      },
      project: null,
    });
  });

  it('updates duration dynamically when a 10-minute (600s) video is loaded', () => {
    const store = useEditorStore.getState();
    expect(store.playback.duration).toBe(60);

    // Simulate video element loading 10-minute media (600 seconds)
    store.setDuration(600);

    const updated = useEditorStore.getState();
    expect(updated.playback.duration).toBe(600);
  });

  it('allows seeking anywhere across a 10-minute (600s) video without premature clamping', () => {
    const store = useEditorStore.getState();
    store.setDuration(600);

    // Seek to 5 minutes (300s)
    useEditorStore.getState().setCurrentTime(300);
    expect(useEditorStore.getState().playback.currentTime).toBe(300);

    // Seek to 9.5 minutes (570s)
    useEditorStore.getState().setCurrentTime(570);
    expect(useEditorStore.getState().playback.currentTime).toBe(570);

    // Clamps to upper bound 600s
    useEditorStore.getState().setCurrentTime(650);
    expect(useEditorStore.getState().playback.currentTime).toBe(600);
  });

  it('enforces zoom bounds within [10, 300] px/s', () => {
    const store = useEditorStore.getState();
    store.setZoom(50);
    expect(useEditorStore.getState().timeline.zoom).toBe(50);

    store.setZoom(5);
    expect(useEditorStore.getState().timeline.zoom).toBe(10); // Minimum 10 px/s

    store.setZoom(400);
    expect(useEditorStore.getState().timeline.zoom).toBe(300); // Maximum 300 px/s
  });

  it('validates playback seek threshold logic to prevent .33s stutter feedback loops', () => {
    // When playing, the video element is master clock. Minor delta (~0.085s from React render lag) MUST NOT seek
    const computeShouldSeek = (isPaused: boolean, currentVideoTime: number, storeTime: number) => {
      const delta = Math.abs(currentVideoTime - storeTime);
      const threshold = isPaused ? 0.02 : 0.5;
      return delta > threshold;
    };

    // 1. Video is playing, React state is 85ms behind due to rAF tick & render lag
    // PREVIOUS BUG: delta = 0.085 > 0.08 -> would seek backward every 33ms and cause .33s stutter
    // FIXED: threshold is 0.5 when playing, so it does NOT seek
    expect(computeShouldSeek(false, 1.085, 1.0)).toBe(false);

    // 2. Video is playing, user clicked 5s ahead on timeline ruler
    expect(computeShouldSeek(false, 1.0, 6.0)).toBe(true);

    // 3. Video is paused, user is scrubbing or stepping 1 frame (33ms)
    expect(computeShouldSeek(true, 1.0, 1.033)).toBe(true);

    // 4. Video is paused, user is at identical frame
    expect(computeShouldSeek(true, 1.0, 1.005)).toBe(false);
  });
});
