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
  Scissors,
  Edit3,
} from 'lucide-react';
import {
  useEditorStore,
  selectEffectivePlan,
  selectDerivedTracks,
  DerivedTrackVM,
  TrackClipVM,
} from '../../stores/editorStore';
import { api } from '../../api/client';
import { toast } from '../../stores/toastStore';
import { COLOR_PRESETS } from '@ai-video/shared';

export const TimelineView: React.FC = () => {
  const {
    timeline,
    playback,
    setCurrentTime,
    setPlaybackStatus,
    togglePlayback,
    setZoom,
    setScrollX,
    fitTimelineToWidth,
    toggleSnap,
    selectLayer,
    deleteSelectedLayers,
    updateLayerRange,
    splitLayerAtTime,
    splitSubtitleCueAtTime,
    updateCueTiming,
    updateCueText,
    deleteCue,
    updateDraft,
    project,
  } = useEditorStore();

  const togglePlay = useCallback(() => {
    togglePlayback();
  }, [togglePlayback]);

  const effectivePlan = useEditorStore(selectEffectivePlan);
  const derivedTracks = useEditorStore(selectDerivedTracks);

  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [activeSnapLine, setActiveSnapLine] = useState<number | null>(null);
  const [activeTrim, setActiveTrim] = useState<{
    layerId: string;
    handle: 'left' | 'right';
    initialStart: number;
    initialEnd: number;
    currentStart: number;
    currentEnd: number;
  } | null>(null);

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

  // Handle razor split cut at playhead
  const handleSplitAtPlayhead = useCallback(() => {
    const curSec = playback.currentTime;
    const selectedId = timeline.selectedLayerIds[0];
    const success = splitLayerAtTime(curSec, selectedId);
    if (success) {
      toast.success(`Split cut at ${curSec.toFixed(2)}s`, 'Razor Split');
    } else {
      const cueSuccess = splitSubtitleCueAtTime(curSec);
      if (cueSuccess) {
        toast.success(`Split subtitle cue at ${curSec.toFixed(2)}s`, 'Subtitle Split');
        if (project) {
          const cues = useEditorStore.getState().project?.analysisSummary?.cues || [];
          api.updateCaptions(project.id, cues).catch(() => {});
        }
      } else {
        toast.info('No cut or layer under playhead to split', 'Split Cut');
      }
    }
  }, [playback.currentTime, timeline.selectedLayerIds, splitLayerAtTime, splitSubtitleCueAtTime, project]);

  // Handle interactive edge trimming (resizing clip start or end boundary)
  const handleStartTrim = (
    e: React.MouseEvent,
    clip: TrackClipVM,
    handle: 'left' | 'right'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (!clip.layerId && clip.cueIndex === undefined) return;

    const initialStart = clip.startSec;
    const initialEnd = clip.startSec + clip.durSec;
    const startX = e.clientX;
    const isCue = clip.cueIndex !== undefined;
    const cueIdx = clip.cueIndex;

    setActiveTrim({
      layerId: clip.layerId || clip.id,
      handle,
      initialStart,
      initialEnd,
      currentStart: initialStart,
      currentEnd: initialEnd,
    });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaSec = (moveEvent.clientX - startX) / zoom;
      let newStart = initialStart;
      let newEnd = initialEnd;

      if (handle === 'left') {
        newStart = Math.max(0, initialStart + deltaSec);
        if (timeline.snap) {
          const snapRadiusSec = 10 / zoom;
          const nearest = snapBoundaries.current.find(
            (pt) => Math.abs(pt - newStart) <= snapRadiusSec
          );
          if (nearest !== undefined) {
            newStart = nearest;
            setActiveSnapLine(nearest * zoom);
          } else {
            newStart = Math.round(newStart / frameDuration) * frameDuration;
            setActiveSnapLine(null);
          }
        }
        newStart = Math.min(newStart, initialEnd - 0.1);
        if (isCue && cueIdx !== undefined) {
          updateCueTiming(cueIdx, newStart, initialEnd);
        } else if (clip.layerId) {
          updateLayerRange(clip.layerId, newStart, initialEnd);
        }
        setCurrentTime(newStart);
      } else {
        newEnd = Math.min(totalDuration, initialEnd + deltaSec);
        if (timeline.snap) {
          const snapRadiusSec = 10 / zoom;
          const nearest = snapBoundaries.current.find(
            (pt) => Math.abs(pt - newEnd) <= snapRadiusSec
          );
          if (nearest !== undefined) {
            newEnd = nearest;
            setActiveSnapLine(nearest * zoom);
          } else {
            newEnd = Math.round(newEnd / frameDuration) * frameDuration;
            setActiveSnapLine(null);
          }
        }
        newEnd = Math.max(newEnd, initialStart + 0.1);
        if (isCue && cueIdx !== undefined) {
          updateCueTiming(cueIdx, initialStart, newEnd);
        } else if (clip.layerId) {
          updateLayerRange(clip.layerId, initialStart, newEnd);
        }
        setCurrentTime(newEnd);
      }

      setActiveTrim((prev) =>
        prev
          ? {
              ...prev,
              currentStart: newStart,
              currentEnd: newEnd,
            }
          : null
      );
    };

    const handleMouseUp = () => {
      if (isCue && project) {
        const latestCues = useEditorStore.getState().project?.analysisSummary?.cues || [];
        api.updateCaptions(project.id, latestCues).catch(() => {});
      }
      setActiveTrim(null);
      setActiveSnapLine(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // State & Handlers for direct timeline subtitle text editing
  const [editingTimelineCueIndex, setEditingTimelineCueIndex] = useState<number | null>(null);
  const [editingTimelineCueText, setEditingTimelineCueText] = useState<string>('');

  // State for direct timeline color preset picker
  const [editingTimelineColorLayerId, setEditingTimelineColorLayerId] = useState<string | null>(null);

  const handleStartTimelineCueEdit = (index: number, text: string) => {
    setEditingTimelineCueIndex(index);
    setEditingTimelineCueText(text);
  };

  const handleSaveTimelineCueText = (index: number) => {
    if (!project) return;
    updateCueText(index, editingTimelineCueText);
    setEditingTimelineCueIndex(null);
    toast.success('Updated subtitle on timeline', 'Timeline Subtitle');
    const updatedCues = useEditorStore.getState().project?.analysisSummary?.cues || [];
    api.updateCaptions(project.id, updatedCues).catch(() => {});
  };

  // Playhead Auto-Scroll / Follow during playback
  useEffect(() => {
    if (playback.status === 'playing' && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const playheadPx = playback.currentTime * zoom;
      const visibleLeft = container.scrollLeft;
      const visibleRight = visibleLeft + container.clientWidth;

      // When playhead nears the right boundary or falls behind left, scroll immediately to keep playhead in view
      if (playheadPx > visibleRight - 60 || playheadPx < visibleLeft) {
        container.scrollLeft = Math.max(0, playheadPx - 100);
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
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleSplitAtPlayhead();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timeline.selectedLayerIds, deleteSelectedLayers, handleSplitAtPlayhead]);

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

          {/* Razor Split Tool */}
          <button
            onClick={handleSplitAtPlayhead}
            className="flex items-center space-x-1 sm:space-x-1.5 px-2 sm:px-2.5 py-0.5 rounded text-[11px] font-mono transition-colors shrink-0 bg-[#2A2C2F] hover:bg-[#34373B] text-[#FFF5F5] border border-[#393B3F] hover:border-[#E3B5BE]/60 active:scale-95"
            title="Split Cut / Layer at Playhead (S)"
          >
            <Scissors className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span>Split</span>
            <span className="hidden sm:inline text-[9px] font-mono bg-[#18191B] px-1 py-0.2 rounded text-[#FFF5F5]/40 border border-[#393B3F]">
              S
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
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  handleSplitAtPlayhead();
                }}
                className="w-4 h-4 bg-[#E3B5BE] hover:bg-[#F7D7D1] rounded-full -ml-[7px] -mt-1 shadow-md shadow-[#E3B5BE]/80 cursor-pointer pointer-events-auto hover:scale-125 active:scale-95 transition-all flex items-center justify-center group/playhead"
                title={`Playhead at ${playback.currentTime.toFixed(2)}s (Click pink handle or press S to cut timeline here)`}
              >
                <Scissors className="w-2.5 h-2.5 text-[#18191B] opacity-0 group-hover/playhead:opacity-100 transition-opacity" />
              </div>
            </div>

            {/* Render Each Derived Track Lane */}
            <div
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest('[data-clip="true"]')) return;
                if (!scrollContainerRef.current) return;
                setIsScrubbing(true);
                const container = scrollContainerRef.current;
                const rect = container.getBoundingClientRect();
                const offsetX = e.clientX - rect.left + container.scrollLeft;
                setCurrentTime(calculateSnappedTime(offsetX));

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  const moveOffsetX = moveEvent.clientX - rect.left + container.scrollLeft;
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
              }}
              className="flex flex-col relative select-none"
            >
              {derivedTracks.map((track) => (
                <div key={track.id} className="h-11 border-b border-[#393B3F]/60 relative py-1">
                  {track.clips.map((clip) => {
                    const isSelected = !!clip.layerId && selectedLayerIds.includes(clip.layerId);
                    const leftPx = clip.startSec * zoom;
                    const widthPx = Math.max(12, clip.durSec * zoom);

                    return (
                      <div
                        key={clip.id}
                        data-clip="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (clip.layerId) {
                            selectLayer(clip.layerId, e.shiftKey);
                          }
                          setCurrentTime(clip.startSec);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (clip.cueIndex !== undefined) {
                            const cue = project?.analysisSummary?.cues?.[clip.cueIndex];
                            handleStartTimelineCueEdit(
                              clip.cueIndex,
                              cue?.text || clip.label.replace(/^"|"$/g, '')
                            );
                          } else if (clip.type === 'color' && clip.layerId) {
                            selectLayer(clip.layerId);
                            setEditingTimelineColorLayerId(
                              editingTimelineColorLayerId === clip.layerId ? null : (clip.layerId || null)
                            );
                          }
                        }}
                        style={{
                          left: `${leftPx}px`,
                          width: `${widthPx}px`,
                        }}
                        className={`absolute top-1 bottom-1 group ${getClipStyle(clip, isSelected)}`}
                        title={`${clip.label} (${clip.startSec.toFixed(2)}s - ${(clip.startSec + clip.durSec).toFixed(2)}s)`}
                      >
                        {/* Inline Timeline Subtitle Editor Popover */}
                        {editingTimelineCueIndex === clip.cueIndex && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute -top-16 left-0 min-w-[260px] max-w-[400px] bg-[#18191B]/95 backdrop-blur-md border border-[#E3B5BE] rounded-lg p-2.5 shadow-2xl z-50 flex flex-col gap-1.5 animate-in fade-in zoom-in-95 pointer-events-auto"
                          >
                            <div className="flex items-center justify-between text-[10px] font-mono text-[#F7D7D1]">
                              <span>Edit Subtitle on Timeline</span>
                              <button
                                type="button"
                                onClick={() => setEditingTimelineCueIndex(null)}
                                className="text-[#FFF5F5]/60 hover:text-white"
                              >
                                ✕
                              </button>
                            </div>
                            <input
                              type="text"
                              value={editingTimelineCueText}
                              onChange={(e) => setEditingTimelineCueText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveTimelineCueText(clip.cueIndex!);
                                } else if (e.key === 'Escape') {
                                  setEditingTimelineCueIndex(null);
                                }
                              }}
                              autoFocus
                              className="w-full bg-[#121314] text-[#FFF5F5] text-xs font-semibold rounded px-2.5 py-1.5 border border-[#393B3F] focus:border-[#E3B5BE] focus:outline-none"
                            />
                            <div className="flex items-center justify-between text-[9px] text-[#FFF5F5]/40 font-mono">
                              <span>Enter save • Esc cancel</span>
                              <button
                                type="button"
                                onClick={() => handleSaveTimelineCueText(clip.cueIndex!)}
                                className="px-2.5 py-0.5 rounded bg-[#E3B5BE] text-[#18191B] font-bold text-[10px]"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Inline Timeline Color Grade LUT Preset Popover */}
                        {editingTimelineColorLayerId === clip.layerId && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute -top-28 left-0 min-w-[280px] bg-[#18191B]/95 backdrop-blur-md border border-[#E3B5BE] rounded-lg p-2.5 shadow-2xl z-50 flex flex-col gap-2 animate-in fade-in zoom-in-95 pointer-events-auto"
                          >
                            <div className="flex items-center justify-between text-[10px] font-mono text-[#F7D7D1]">
                              <span className="flex items-center gap-1">
                                <Palette className="w-3 h-3 text-[#E3B5BE]" />
                                <span>Switch LUT Preset on Timeline</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => setEditingTimelineColorLayerId(null)}
                                className="text-[#FFF5F5]/60 hover:text-white"
                              >
                                ✕
                              </button>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              {[
                                { id: 'cinematic', label: 'Cinematic' },
                                { id: 'warm', label: 'Warm 35mm' },
                                { id: 'cool', label: 'Teal/Orange' },
                                { id: 'bw', label: 'Noir B&W' },
                                { id: 'vivid', label: 'Vivid Pop' },
                                { id: 'faded', label: 'Faded Retro' },
                              ].map((preset) => {
                                const isActive =
                                  (clip.layerRef as any)?.params?.preset === preset.id;
                                return (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => {
                                      const p = (COLOR_PRESETS as any)[preset.id];
                                      updateDraft((d) => {
                                        const c = d.layers.find((l) => l.id === clip.layerId) as any;
                                        if (c) {
                                          c.params.preset = preset.id;
                                          if (p) {
                                            c.params.contrast = p.contrast;
                                            c.params.saturation = p.saturation;
                                            c.params.brightness = p.brightness;
                                            c.params.vignette = p.vignette;
                                          }
                                        }
                                      });
                                      toast.success(
                                        `Set LUT preset to ${preset.label}`,
                                        'Color Grade'
                                      );
                                    }}
                                    className={`px-1.5 py-1 rounded text-[10px] font-medium border text-center transition-all ${
                                      isActive
                                        ? 'bg-[#E3B5BE]/25 text-[#F7D7D1] border-[#E3B5BE] font-semibold'
                                        : 'bg-[#222326] hover:bg-[#2A2C2F] text-[#FFF5F5]/70 border-[#393B3F]'
                                    }`}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Left Edge Trim Handle */}
                        {clip.layerId && clip.durSec >= 0.2 && (
                          <div
                            onMouseDown={(e) => handleStartTrim(e, clip, 'left')}
                            className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-[#E3B5BE] active:bg-[#F7D7D1] rounded-l flex items-center justify-center group/trim z-30 transition-colors pointer-events-auto"
                            title="Drag to trim start boundary"
                          >
                            <div className="w-0.5 h-3 bg-white/40 group-hover/trim:bg-[#18191B] rounded-full" />
                          </div>
                        )}

                        {/* Edit pencil button for subtitle cues */}
                        {clip.cueIndex !== undefined && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const cue = project?.analysisSummary?.cues?.[clip.cueIndex!];
                              handleStartTimelineCueEdit(
                                clip.cueIndex!,
                                cue?.text || clip.label.replace(/^"|"$/g, '')
                              );
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/20 text-[#FFF5F5] mr-1 shrink-0 z-20 pointer-events-auto"
                            title="Double-click or click pencil to edit text"
                          >
                            <Edit3 className="w-2.5 h-2.5 text-[#E3B5BE]" />
                          </button>
                        )}

                        {/* Quick LUT preset button for color clips */}
                        {clip.type === 'color' && clip.layerId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectLayer(clip.layerId!);
                              setEditingTimelineColorLayerId(
                                editingTimelineColorLayerId === clip.layerId ? null : (clip.layerId || null)
                              );
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/20 text-[#FFF5F5] mr-1 shrink-0 z-20 pointer-events-auto"
                            title="Click or double-click to switch LUT preset"
                          >
                            <Palette className="w-2.5 h-2.5 text-[#E3B5BE]" />
                          </button>
                        )}

                        <span className="truncate px-1 pointer-events-none">{clip.label}</span>

                        {/* Right Edge Trim Handle */}
                        {clip.layerId && clip.durSec >= 0.2 && (
                          <div
                            onMouseDown={(e) => handleStartTrim(e, clip, 'right')}
                            className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-[#E3B5BE] active:bg-[#F7D7D1] rounded-r flex items-center justify-center group/trim z-30 transition-colors pointer-events-auto"
                            title="Drag to trim end boundary"
                          >
                            <div className="w-0.5 h-3 bg-white/40 group-hover/trim:bg-[#18191B] rounded-full" />
                          </div>
                        )}

                        {/* Floating Trim Timecode Badge */}
                        {activeTrim && activeTrim.layerId === (clip.layerId || clip.id) && (
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-black/95 text-[#F7D7D1] text-[10px] font-mono px-2 py-0.5 rounded shadow-xl border border-[#E3B5BE] z-50 pointer-events-none whitespace-nowrap">
                            {activeTrim.currentStart.toFixed(2)}s - {activeTrim.currentEnd.toFixed(2)}s ({(activeTrim.currentEnd - activeTrim.currentStart).toFixed(2)}s)
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
