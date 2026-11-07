import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Music,
  Type,
  Video,
  Magnet,
  Palette,
  Layers,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  useEditorStore,
  selectEffectivePlan,
  selectDerivedTracks,
  DerivedTrackVM,
  TrackClipVM,
} from '../../stores/editorStore';

export const TimelineView: React.FC = () => {
  const {
    timeline,
    playback,
    setCurrentTime,
    setZoom,
    setScrollX,
    fitTimelineToWidth,
    toggleSnap,
    selectLayer,
    deleteSelectedLayers,
    project,
  } = useEditorStore();

  const effectivePlan = useEditorStore(selectEffectivePlan);
  const derivedTracks = useEditorStore(selectDerivedTracks);

  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [activeSnapLine, setActiveSnapLine] = useState<number | null>(null);

  const zoom = timeline.zoom; // pixels per second
  const totalDuration = playback.duration || project?.durationSec || 60;
  const fps = project?.fps || effectivePlan?.global?.fps || 30;
  const frameDuration = 1 / fps;
  const timelineWidth = Math.max(900, totalDuration * zoom);

  // Collect boundary snap points from all clips
  const snapBoundaries = useRef<number[]>([]);
  useEffect(() => {
    const points = new Set<number>([0, totalDuration]);
    derivedTracks.forEach((t) => {
      t.clips.forEach((c) => {
        points.add(Number(c.startSec.toFixed(3)));
        points.add(Number((c.startSec + c.durSec).toFixed(3)));
      });
    });
    snapBoundaries.current = Array.from(points);
  }, [derivedTracks, totalDuration]);

  // Magnetic & Frame Snapping calculation
  const calculateSnappedTime = useCallback(
    (offsetX: number) => {
      let rawSec = Math.max(0, Math.min(offsetX / zoom, totalDuration));

      if (timeline.snap) {
        // 1. Magnetic Clip Boundary Snapping (10px magnetic radius)
        const snapRadiusSec = 10 / zoom;
        const nearestSnap = snapBoundaries.current.find(
          (pt) => Math.abs(pt - rawSec) <= snapRadiusSec
        );

        if (nearestSnap !== undefined) {
          rawSec = nearestSnap;
          setActiveSnapLine(nearestSnap * zoom);
        } else {
          // 2. Exact Frame Grid Snapping (1 / fps)
          rawSec = Math.round(rawSec / frameDuration) * frameDuration;
          setActiveSnapLine(null);
        }
      } else {
        setActiveSnapLine(null);
      }

      return rawSec;
    },
    [zoom, totalDuration, timeline.snap, frameDuration]
  );

  // Handle ruler mouse down and scrubbing
  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rulerRef.current) return;
    setIsScrubbing(true);
    const rect = rulerRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    setCurrentTime(calculateSnappedTime(offsetX));

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!rulerRef.current) return;
      const moveOffsetX = moveEvent.clientX - rect.left;
      setCurrentTime(calculateSnappedTime(moveOffsetX));
    };

    const handleMouseUp = () => {
      setIsScrubbing(false);
      setActiveSnapLine(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Playhead Auto-Scroll / Follow during playback
  useEffect(() => {
    if (playback.status === 'playing' && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const playheadPx = playback.currentTime * zoom;
      const visibleLeft = container.scrollLeft;
      const visibleRight = visibleLeft + container.clientWidth;

      // When playhead nears the right boundary or falls behind left
      if (playheadPx > visibleRight - 80 || playheadPx < visibleLeft) {
        container.scrollTo({
          left: Math.max(0, playheadPx - 100),
          behavior: 'smooth',
        });
      }
    }
  }, [playback.currentTime, playback.status, zoom]);

  // Ctrl + Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 15 : -15;
      setZoom(zoom + delta);
    }
  };

  // Synchronize horizontal scroll state
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollX(e.currentTarget.scrollLeft);
  };

  // Fit timeline to window width
  const handleFitToWindow = () => {
    if (scrollContainerRef.current) {
      fitTimelineToWidth(scrollContainerRef.current.clientWidth);
    }
  };

  // Keyboard Delete key for selected layers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (timeline.selectedLayerIds.length > 0) {
          e.preventDefault();
          deleteSelectedLayers();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timeline.selectedLayerIds, deleteSelectedLayers]);

  // Generate ruler tick marks based on zoom level
  const tickStep = zoom > 120 ? 1 : zoom > 50 ? 5 : 10;
  const rulerTicks = [];
  for (let sec = 0; sec <= totalDuration; sec += tickStep) {
    rulerTicks.push(sec);
  }

  const selectedLayerIds = timeline.selectedLayerIds;

  const getTrackIcon = (kind: DerivedTrackVM['kind']) => {
    switch (kind) {
      case 'video':
        return <Video className="w-3.5 h-3.5 text-blue-400" />;
      case 'subtitle':
        return <Type className="w-3.5 h-3.5 text-amber-400" />;
      case 'text':
        return <Layers className="w-3.5 h-3.5 text-cyan-400" />;
      case 'music':
        return <Music className="w-3.5 h-3.5 text-emerald-400" />;
      case 'fx':
        return <Palette className="w-3.5 h-3.5 text-indigo-400" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  const getClipStyle = (clip: TrackClipVM, isSelected: boolean) => {
    const base =
      'h-full rounded-md cursor-pointer flex items-center px-2.5 text-xs truncate transition-all select-none ';
    if (isSelected) {
      return base + 'ring-2 ring-white shadow-lg z-20 brightness-115 font-semibold';
    }

    switch (clip.type) {
      case 'intro':
      case 'outro':
        return (
          base +
          'bg-purple-900/40 border border-purple-500/50 text-purple-200 hover:border-purple-400'
        );
      case 'cut':
        return (
          base +
          'bg-red-500/30 border border-red-500/60 text-red-200 hover:bg-red-500/45 text-[10px] font-mono justify-center'
        );
      case 'speed':
        return (
          base + 'bg-cyan-900/40 border border-cyan-500/50 text-cyan-200 hover:border-cyan-400'
        );
      case 'subtitle':
        return (
          base + 'bg-amber-900/30 border border-amber-600/40 text-amber-200 hover:border-amber-400'
        );
      case 'text':
        return base + 'bg-sky-900/35 border border-sky-500/50 text-sky-200 hover:border-sky-400';
      case 'music':
        return (
          base +
          'bg-emerald-900/30 border border-emerald-600/40 text-emerald-200 hover:border-emerald-400'
        );
      case 'color':
        return (
          base +
          'bg-indigo-900/30 border border-indigo-600/40 text-indigo-200 hover:border-indigo-400'
        );
      case 'overlay':
        return (
          base + 'bg-pink-900/30 border border-pink-500/40 text-pink-200 hover:border-pink-400'
        );
      case 'transition':
        return (
          base +
          'bg-orange-900/40 border border-orange-500/50 text-orange-200 hover:border-orange-400'
        );
      default:
        return (
          base + 'bg-blue-900/30 border border-blue-600/40 text-blue-200 hover:border-blue-400'
        );
    }
  };

  return (
    <div
      onWheel={handleWheel}
      className="h-64 bg-[#0B0F17] border-t border-surfaceBorder flex flex-col select-none"
    >
      {/* Timeline Controls Header */}
      <div className="h-10 border-b border-surfaceBorder px-4 flex items-center justify-between bg-surface/50">
        <div className="flex items-center space-x-3 text-xs text-slate-400">
          <span className="font-semibold text-slate-200">Derived Timeline Tracks</span>
          <span className="text-slate-600">•</span>
          <span className="font-mono text-[11px] text-slate-400">
            {effectivePlan?.layers.length || 0} active layers
          </span>
          <span className="text-slate-600">•</span>

          {/* Magnetic Frame Snapping Toggle */}
          <button
            onClick={toggleSnap}
            className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
              timeline.snap
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                : 'bg-surface text-slate-500 border border-surfaceBorder hover:text-slate-300'
            }`}
            title="Toggle Magnetic Clip & Frame Snapping"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Snapping {timeline.snap ? 'ON' : 'OFF'}</span>
            <span className="text-[10px] text-slate-500 font-mono">({fps}fps)</span>
          </button>

          {/* Delete selected layer button */}
          {selectedLayerIds.length > 0 && (
            <button
              onClick={deleteSelectedLayers}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 text-[11px] transition-colors"
              title="Delete Selected Layers (Del)"
            >
              <Trash2 className="w-3 h-3" />
              <span>Delete ({selectedLayerIds.length})</span>
            </button>
          )}
        </div>

        {/* Zoom Controls & Fit to Window */}
        <div className="flex items-center space-x-2">
          {/* Fit to Window */}
          <button
            onClick={handleFitToWindow}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-surface hover:bg-slate-800 text-slate-300 text-[11px] border border-surfaceBorder transition-colors"
            title="Fit timeline to window"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Fit</span>
          </button>

          <div className="flex items-center space-x-1 bg-surface p-0.5 rounded-lg border border-surfaceBorder">
            <button
              onClick={() => setZoom(zoom - 15)}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Zoom out (Ctrl -)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-slate-300 px-2 min-w-[55px] text-center">
              {zoom} px/s
            </span>
            <button
              onClick={() => setZoom(zoom + 15)}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Zoom in (Ctrl +)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Tracks & Playhead Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Track Headers (Left sidebar) */}
        <div className="w-44 border-r border-surfaceBorder bg-surface flex flex-col shrink-0 text-xs">
          <div className="h-6 border-b border-surfaceBorder" /> {/* Ruler spacer */}
          {derivedTracks.map((track) => (
            <div
              key={track.id}
              className="h-11 border-b border-surfaceBorder px-3 flex items-center space-x-2 text-slate-300"
            >
              {getTrackIcon(track.kind)}
              <span className="font-medium text-[11px] truncate">{track.name}</span>
            </div>
          ))}
          {derivedTracks.length === 0 && (
            <div className="p-3 text-slate-500 italic text-[11px]">No layers defined</div>
          )}
        </div>

        {/* Scrollable Track Canvas with Auto-Scroll & Scroll Tracking */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onClick={() => selectLayer(null)}
          className="flex-1 overflow-x-auto relative bg-[#070A10]"
        >
          <div style={{ width: `${timelineWidth}px` }} className="relative h-full">
            {/* Time Ruler */}
            <div
              ref={rulerRef}
              onMouseDown={handleRulerMouseDown}
              className="h-6 border-b border-surfaceBorder bg-surface/40 cursor-ew-resize relative select-none"
            >
              {rulerTicks.map((sec) => (
                <div
                  key={sec}
                  style={{ left: `${sec * zoom}px` }}
                  className="absolute top-0 bottom-0 border-l border-slate-700/80 flex flex-col justify-between pl-1 pointer-events-none"
                >
                  <span className="text-[9px] font-mono text-slate-400">{sec}s</span>
                </div>
              ))}
            </div>

            {/* Magnetic Snap Guideline (Cyan) */}
            {activeSnapLine !== null && (
              <div
                style={{ left: `${activeSnapLine}px` }}
                className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 z-40 pointer-events-none shadow-sm shadow-cyan-400"
              />
            )}

            {/* Red Playhead Line & Handle */}
            <div
              style={{ left: `${playback.currentTime * zoom}px` }}
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none transition-[left] duration-75"
            >
              <div className="w-3.5 h-3.5 bg-red-500 rounded-full -ml-[6px] -mt-1 shadow-md shadow-red-500/60" />
            </div>

            {/* Render Each Derived Track Lane */}
            {derivedTracks.map((track) => (
              <div key={track.id} className="h-11 border-b border-surfaceBorder/60 relative py-1">
                {track.clips.map((clip) => {
                  const isSelected = !!clip.layerId && selectedLayerIds.includes(clip.layerId);
                  const leftPx = clip.startSec * zoom;
                  const widthPx = Math.max(12, clip.durSec * zoom);

                  return (
                    <div
                      key={clip.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (clip.layerId) {
                          selectLayer(clip.layerId, e.shiftKey);
                        }
                      }}
                      style={{
                        left: `${leftPx}px`,
                        width: `${widthPx}px`,
                      }}
                      className={`absolute top-1 bottom-1 ${getClipStyle(clip, isSelected)}`}
                      title={`${clip.label} (${clip.startSec.toFixed(2)}s - ${(clip.startSec + clip.durSec).toFixed(2)}s)`}
                    >
                      <span className="truncate">{clip.label}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
