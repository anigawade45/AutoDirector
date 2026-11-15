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
  Play,
  Pause,
} from 'lucide-react';
import {
  useEditorStore,
  selectEffectivePlan,
  selectDerivedTracks,
  DerivedTrackVM,
  TrackClipVM,
} from '../../stores/editorStore';
import { toast } from '../../stores/toastStore';

export const TimelineView: React.FC = () => {
  const {
    timeline,
    playback,
    setCurrentTime,
    setPlaybackStatus,
    setZoom,
    setScrollX,
    fitTimelineToWidth,
    toggleSnap,
    selectLayer,
    deleteSelectedLayers,
    project,
  } = useEditorStore();

  const togglePlay = useCallback(() => {
    const video = document.querySelector('video');
    if (video) {
      if (video.paused) {
        video.play();
        setPlaybackStatus('playing');
      } else {
        video.pause();
        setPlaybackStatus('paused');
      }
    }
  }, [setPlaybackStatus]);

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
      toast.info('Timeline fit to window width', 'View Reset');
    }
  };

  const handleDeleteSelected = () => {
    const count = timeline.selectedLayerIds.length;
    if (count > 0) {
      deleteSelectedLayers();
      toast.warning(`Deleted ${count} layer(s) from sequence`, 'Layer Removed');
    }
  };

  const handleToggleSnap = () => {
    const nextSnap = !timeline.snap;
    toggleSnap();
    toast.info(nextSnap ? 'Magnetic snapping enabled' : 'Magnetic snapping disabled', 'Snapping');
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
          handleDeleteSelected();
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
        return <Video className="w-3.5 h-3.5 text-[#E3B5BE]" />;
      case 'subtitle':
        return <Type className="w-3.5 h-3.5 text-[#F7D7D1]" />;
      case 'text':
        return <Layers className="w-3.5 h-3.5 text-[#FFF5F5]" />;
      case 'music':
        return <Music className="w-3.5 h-3.5 text-[#F7D7D1]" />;
      case 'fx':
        return <Palette className="w-3.5 h-3.5 text-[#E3B5BE]" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-[#FFF5F5]/60" />;
    }
  };

  const getClipStyle = (clip: TrackClipVM, isSelected: boolean) => {
    const base =
      'h-full rounded-md cursor-pointer flex items-center px-2.5 text-xs truncate transition-all select-none ';
    if (isSelected) {
      return base + 'ring-2 ring-[#FFF5F5] shadow-lg z-20 font-semibold';
    }

    switch (clip.type) {
      case 'intro':
      case 'outro':
        return (
          base + 'bg-[#2A262C] border border-[#E3B5BE]/50 text-[#FFF5F5] hover:border-[#E3B5BE]'
        );
      case 'cut':
        return (
          base +
          'bg-[#362225] border border-[#E3B5BE]/50 text-[#F7D7D1] hover:bg-[#3D2529] text-[10px] font-mono justify-center'
        );
      case 'speed':
        return base + 'bg-[#25282B] border border-[#393B3F] text-[#FFF5F5] hover:border-[#E3B5BE]';
      case 'subtitle':
        return (
          base + 'bg-[#2E2729] border border-[#E3B5BE]/40 text-[#F7D7D1] hover:border-[#E3B5BE]'
        );
      case 'text':
        return base + 'bg-[#2A2C2F] border border-[#393B3F] text-[#FFF5F5] hover:border-[#E3B5BE]';
      case 'music':
        return (
          base + 'bg-[#232724] border border-[#393B3F] text-[#FFF5F5]/90 hover:border-[#F7D7D1]'
        );
      case 'color':
        return (
          base + 'bg-[#2B2527] border border-[#E3B5BE]/40 text-[#E3B5BE] hover:border-[#E3B5BE]'
        );
      case 'overlay':
        return (
          base + 'bg-[#2E282B] border border-[#E3B5BE]/30 text-[#FFF5F5] hover:border-[#E3B5BE]'
        );
      case 'transition':
        return (
          base +
          'bg-orange-900/40 border border-orange-500/50 text-orange-200 hover:border-orange-400'
        );
      default:
        return base + 'bg-[#2A2C2F] border border-[#393B3F] text-[#FFF5F5] hover:border-[#E3B5BE]';
    }
  };

  return (
    <div
      onWheel={handleWheel}
      className="h-full lg:h-56 flex-1 lg:flex-initial lg:flex-shrink-0 bg-[#18191B] border-t-0 lg:border-t border-[#393B3F] flex flex-col select-none font-sans min-h-0"
    >
      {/* Timeline Controls Header */}
      <div className="h-10 border-b border-[#393B3F] px-2 sm:px-4 flex items-center justify-between bg-[#18191B] overflow-x-auto gap-2 custom-scrollbar shrink-0">
        <div className="flex items-center space-x-2 sm:space-x-3 text-xs text-[#FFF5F5]/70 shrink-0">
          {/* Quick Timeline Play / Pause Button */}
          <button
            onClick={togglePlay}
            className="flex items-center space-x-1 px-2.5 sm:px-3 py-1 rounded text-xs font-bold uppercase tracking-wider bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] shadow-sm transition-all active:scale-95 shrink-0"
            title={playback.status === 'playing' ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playback.status === 'playing' ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-[#18191B]" />
                <span className="hidden xs:inline">Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-[#18191B] ml-0.5" />
                <span className="hidden xs:inline">Play</span>
              </>
            )}
          </button>

          <span className="hidden sm:inline font-semibold text-[#FFF5F5]">Timeline Sequence</span>
          <span className="hidden sm:inline text-[#393B3F]">•</span>
          <span className="hidden md:inline font-mono text-[11px] text-[#F7D7D1]">
            {effectivePlan?.layers.length || 0} active layers
          </span>
          <span className="hidden md:inline text-[#393B3F]">•</span>

          {/* Magnetic Frame Snapping Toggle */}
          <button
            onClick={handleToggleSnap}
            className={`flex items-center space-x-1 sm:space-x-1.5 px-2 sm:px-2.5 py-0.5 rounded text-[11px] font-mono transition-colors shrink-0 ${
              timeline.snap
                ? 'bg-[#2A2C2F] text-[#F7D7D1] border border-[#E3B5BE]/40'
                : 'bg-[#18191B] text-[#FFF5F5]/50 border border-[#393B3F] hover:text-[#FFF5F5]'
            }`}
            title="Toggle Magnetic Clip & Frame Snapping"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Snap {timeline.snap ? 'ON' : 'OFF'}</span>
            <span className="hidden sm:inline text-[10px] text-[#FFF5F5]/40 font-mono">
              ({fps}fps)
            </span>
          </button>

          {/* Delete selected layer button */}
          {selectedLayerIds.length > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-800/50 text-[11px] transition-colors shrink-0"
              title="Delete Selected Layers (Del)"
            >
              <Trash2 className="w-3 h-3" />
              <span>Delete ({selectedLayerIds.length})</span>
            </button>
          )}
        </div>

        {/* Zoom Controls & Fit to Window */}
        <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
          {/* Fit to Window */}
          <button
            onClick={handleFitToWindow}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#2A2C2F] hover:bg-[#34373B] text-[#FFF5F5] text-[11px] border border-[#393B3F] transition-colors"
            title="Fit timeline to window"
          >
            <Maximize2 className="w-3 h-3 text-[#E3B5BE]" />
            <span>Fit</span>
          </button>

          <div className="flex items-center space-x-1 bg-[#2A2C2F] p-0.5 rounded-lg border border-[#393B3F]">
            <button
              onClick={() => setZoom(zoom - 15)}
              className="p-1 rounded hover:bg-[#34373B] text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors"
              title="Zoom out (Ctrl -)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-[#F7D7D1] px-2 min-w-[55px] text-center">
              {zoom} px/s
            </span>
            <button
              onClick={() => setZoom(zoom + 15)}
              className="p-1 rounded hover:bg-[#34373B] text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors"
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
        <div className="w-44 border-r border-[#393B3F] bg-[#18191B] flex flex-col shrink-0 text-xs">
          <div className="h-6 border-b border-[#393B3F]" /> {/* Ruler spacer */}
          {derivedTracks.map((track) => (
            <div
              key={track.id}
              className="h-11 border-b border-[#393B3F] px-3 flex items-center space-x-2 text-[#FFF5F5]"
            >
              {getTrackIcon(track.kind)}
              <span className="font-medium text-[11px] truncate">{track.name}</span>
            </div>
          ))}
          {derivedTracks.length === 0 && (
            <div className="p-3 text-[#FFF5F5]/40 italic text-[11px]">No layers defined</div>
          )}
        </div>

        {/* Scrollable Track Canvas with Auto-Scroll & Scroll Tracking */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onClick={() => selectLayer(null)}
          className="flex-1 overflow-x-auto relative bg-[#121314]"
        >
          <div style={{ width: `${timelineWidth}px` }} className="relative h-full">
            {/* Time Ruler */}
            <div
              ref={rulerRef}
              onMouseDown={handleRulerMouseDown}
              className="h-6 border-b border-[#393B3F] bg-[#18191B] cursor-ew-resize relative select-none"
            >
              {rulerTicks.map((sec) => (
                <div
                  key={sec}
                  style={{ left: `${sec * zoom}px` }}
                  className="absolute top-0 bottom-0 border-l border-[#393B3F] flex flex-col justify-between pl-1 pointer-events-none"
                >
                  <span className="text-[9px] font-mono text-[#FFF5F5]/50">{sec}s</span>
                </div>
              ))}
            </div>

            {/* Magnetic Snap Guideline */}
            {activeSnapLine !== null && (
              <div
                style={{ left: `${activeSnapLine}px` }}
                className="absolute top-0 bottom-0 w-0.5 bg-[#F7D7D1] z-40 pointer-events-none shadow-sm shadow-[#F7D7D1]/80"
              />
            )}

            {/* Playhead Line & Handle in Dusty Rose */}
            <div
              style={{ left: `${playback.currentTime * zoom}px` }}
              className="absolute top-0 bottom-0 w-0.5 bg-[#E3B5BE] z-30 pointer-events-none transition-[left] duration-75"
            >
              <div className="w-3.5 h-3.5 bg-[#E3B5BE] rounded-full -ml-[6px] -mt-1 shadow-md shadow-[#E3B5BE]/60" />
            </div>

            {/* Render Each Derived Track Lane */}
            {derivedTracks.map((track) => (
              <div key={track.id} className="h-11 border-b border-[#393B3F]/60 relative py-1">
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
