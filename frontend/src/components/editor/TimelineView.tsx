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
  MousePointer,
  Sliders,
  Check,
  X,
  Plus,
  Minus,
  RotateCcw,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Lock,
  Unlock,
  Copy,
  ChevronDown,
  Image as ImageIcon,
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
import { COLOR_PRESETS, resolveColorParams, getSpeakerColor } from '@ai-video/shared';
import { compare } from 'fast-json-patch';

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
    setToolMode,
    selectLayer,
    deleteSelectedLayers,
    updateLayerRange,
    splitLayerAtTime,
    splitSubtitleCueAtTime,
    updateCueTiming,
    updateCueText,
    updateCueSpeaker,
    deleteCue,
    cleanEmptySubtitleCues,
    moveClip,
    duplicateLayer,
    duplicateCue,
    addTimelineLayer,
    toggleTrackMute,
    toggleTrackLock,
    toggleTrackHidden,
    updateDraft,
    commitDraft,
    project,
    plan,
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

  // Trimming State
  const [activeTrim, setActiveTrim] = useState<{
    layerId: string;
    handle: 'left' | 'right';
    initialStart: number;
    initialEnd: number;
    currentStart: number;
    currentEnd: number;
  } | null>(null);

  // Moving / Drag-and-Drop Clip State
  const [activeMove, setActiveMove] = useState<{
    clipId: string;
    isCue: boolean;
    cueIndex?: number;
    initialStart: number;
    durSec: number;
    currentStart: number;
  } | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    clip: TrackClipVM;
    track: DerivedTrackVM;
  } | null>(null);

  // "+ Add Layer" Dropdown State
  const [isAddLayerOpen, setIsAddLayerOpen] = useState(false);

  const zoom = timeline.zoom; // pixels per second
  const totalDuration = playback.duration || project?.durationSec || 60;
  const fps = project?.fps || effectivePlan?.global?.fps || 30;
  const frameDuration = 1 / fps;
  const timelineWidth = Math.max(900, totalDuration * zoom);

  // Dismiss context menu on click outside or escape
  useEffect(() => {
    const handleCloseMenu = () => {
      setContextMenu(null);
      setIsAddLayerOpen(false);
    };
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

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
    track: DerivedTrackVM,
    handle: 'left' | 'right'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (track.locked) {
      toast.warning('Track is locked. Unlock to trim.', 'Track Locked');
      return;
    }
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
      } else if (!isCue && project && clip.layerId) {
        const currentPlan = useEditorStore.getState().plan;
        if (currentPlan.current && currentPlan.draft) {
          const patch = compare(currentPlan.current, currentPlan.draft);
          if (patch.length > 0) {
            api
              .patchPlan(project.id, currentPlan.version, {
                patch: patch as any,
                baseVersion: currentPlan.version,
              })
              .then((res) => {
                commitDraft(res.plan);
              })
              .catch((err) => {
                console.warn('Trim patch sync failed:', err);
              });
          }
        }
      }
      setActiveTrim(null);
      setActiveSnapLine(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Handle interactive horizontal clip moving (Drag & Drop)
  const handleStartMoveClip = (
    e: React.MouseEvent,
    clip: TrackClipVM,
    track: DerivedTrackVM
  ) => {
    if (timeline.toolMode === 'razor') return;
    if (track.locked) {
      toast.warning('Track is locked. Unlock to move clips.', 'Track Locked');
      return;
    }
    if (!clip.layerId && clip.cueIndex === undefined) return;

    const startX = e.clientX;
    const initialStart = clip.startSec;
    const durSec = clip.durSec;
    const isCue = clip.cueIndex !== undefined;
    const cueIdx = clip.cueIndex;
    const clipId = clip.layerId || clip.id;

    let hasMoved = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      if (!hasMoved && Math.abs(deltaPx) > 4) {
        hasMoved = true;
        setActiveMove({
          clipId,
          isCue,
          cueIndex: cueIdx,
          initialStart,
          durSec,
          currentStart: initialStart,
        });
      }

      if (hasMoved) {
        const deltaSec = deltaPx / zoom;
        let newStart = Math.max(0, initialStart + deltaSec);

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

        const newEnd = Math.min(totalDuration, newStart + durSec);
        moveClip(clipId, newStart, newEnd, isCue, cueIdx);
        setCurrentTime(newStart);

        setActiveMove((prev) =>
          prev
            ? {
                ...prev,
                currentStart: newStart,
              }
            : null
        );
      }
    };

    const handleMouseUp = () => {
      if (hasMoved) {
        if (isCue && project) {
          const latestCues = useEditorStore.getState().project?.analysisSummary?.cues || [];
          api.updateCaptions(project.id, latestCues).catch(() => {});
        } else if (!isCue && project && clip.layerId) {
          const currentPlan = useEditorStore.getState().plan;
          if (currentPlan.current && currentPlan.draft) {
            const patch = compare(currentPlan.current, currentPlan.draft);
            if (patch.length > 0) {
              api
                .patchPlan(project.id, currentPlan.version, {
                  patch: patch as any,
                  baseVersion: currentPlan.version,
                })
                .then((res) => {
                  commitDraft(res.plan);
                })
                .catch((err) => {
                  console.warn('Move patch sync failed:', err);
                });
            }
          }
        }
        toast.info(`Moved "${clip.label}"`, 'Timeline');
      }

      setActiveMove(null);
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
  const [editingTimelineCueSpeaker, setEditingTimelineCueSpeaker] = useState<string>('Speaker 1');

  // State for direct timeline color preset & parameter picker
  const [editingTimelineColorLayerId, setEditingTimelineColorLayerId] = useState<string | null>(null);
  const colorDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const handleStartTimelineCueEdit = (index: number, text: string, speaker = 'Speaker 1') => {
    setEditingTimelineCueIndex(index);
    setEditingTimelineCueText(text);
    setEditingTimelineCueSpeaker(speaker);
  };

  const handleSaveTimelineCueText = (index: number) => {
    if (!project) return;
    updateCueText(index, editingTimelineCueText);
    if (editingTimelineCueSpeaker) {
      updateCueSpeaker(index, editingTimelineCueSpeaker);
    }
    setEditingTimelineCueIndex(null);
    toast.success('Updated subtitle on timeline', 'Timeline Subtitle');
    const updatedCues = useEditorStore.getState().project?.analysisSummary?.cues || [];
    api.updateCaptions(project.id, updatedCues).catch(() => {});
  };

  const handleDeleteTimelineCue = (index: number) => {
    deleteCue(index);
    setEditingTimelineCueIndex(null);
    toast.info('Deleted subtitle cue from timeline', 'Captions');
  };

  // Sync color adjustments to backend with debouncing
  const syncColorChangesToServer = useCallback(() => {
    if (!project) return;
    if (colorDebounceRef.current) clearTimeout(colorDebounceRef.current);
    colorDebounceRef.current = setTimeout(async () => {
      const currentPlan = useEditorStore.getState().plan;
      if (!currentPlan.current || !currentPlan.draft) return;
      const patch = compare(currentPlan.current, currentPlan.draft);
      if (patch.length === 0) return;
      try {
        const res = await api.patchPlan(project.id, currentPlan.version, {
          patch: patch as any,
          baseVersion: currentPlan.version,
        });
        commitDraft(res.plan);
      } catch (err) {
        console.warn('Failed to sync color grade to server:', err);
      }
    }, 600);
  }, [project, commitDraft]);

  // Playhead Auto-Scroll / Follow during playback
  useEffect(() => {
    if (playback.status === 'playing' && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const playheadPx = playback.currentTime * zoom;
      const visibleLeft = container.scrollLeft;
      const visibleRight = visibleLeft + container.clientWidth;

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

  const handleDuplicateSelected = () => {
    const selectedId = timeline.selectedLayerIds[0];
    if (!selectedId) return;

    if (selectedId.startsWith('cue_')) {
      const cues = project?.analysisSummary?.cues || [];
      const idx = cues.findIndex((c, i) => (c.id || `cue_${i + 1}`) === selectedId);
      if (idx !== -1) {
        duplicateCue(idx);
        toast.success('Duplicated subtitle cue', 'Duplicate');
        return;
      }
    }

    duplicateLayer(selectedId);
    toast.success('Duplicated layer', 'Duplicate');
  };

  const handleToggleSnap = () => {
    const nextSnap = !timeline.snap;
    toggleSnap();
    toast.info(nextSnap ? 'Magnetic snapping enabled' : 'Magnetic snapping disabled', 'Snapping');
  };

  const handleCleanEmptyCues = () => {
    const removed = cleanEmptySubtitleCues();
    if (removed > 0) {
      toast.success(`Removed ${removed} empty caption cue(s)`, 'Captions Cleaned');
    } else {
      toast.info('No empty caption cues found', 'Captions');
    }
  };

  // Keyboard shortcuts: Delete, Duplicate (Ctrl+D), Split (S), Razor Tool (C), Select Tool (V), Nudges
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
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        handleDuplicateSelected();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleSplitAtPlayhead();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setToolMode('razor');
        toast.info('Razor Cut Tool active (Click clip to cut)', 'Razor Tool');
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setToolMode('select');
      } else if (e.key === '[' || e.key === ']') {
        const selectedId = timeline.selectedLayerIds[0];
        if (selectedId) {
          e.preventDefault();
          const nudgeSec = (e.shiftKey ? 1.0 : 0.1) * (e.key === '[' ? -1 : 1);
          const clip = derivedTracks.flatMap((t) => t.clips).find((c) => (c.layerId || c.id) === selectedId);
          if (clip) {
            const newStart = Math.max(0, clip.startSec + nudgeSec);
            const newEnd = newStart + clip.durSec;
            moveClip(selectedId, newStart, newEnd, clip.cueIndex !== undefined, clip.cueIndex);
            setCurrentTime(newStart);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timeline.selectedLayerIds, deleteSelectedLayers, handleSplitAtPlayhead, setToolMode, derivedTracks, moveClip, setCurrentTime]);

  // Generate ruler tick marks based on zoom level
  const tickStep = zoom > 120 ? 1 : zoom > 50 ? 5 : 10;
  const rulerTicks = [];
  for (let sec = 0; sec <= totalDuration; sec += tickStep) {
    rulerTicks.push(sec);
  }

  // Scene cut boundary points from analysis
  const sceneCuts = project?.analysisSummary?.sceneCuts || [];
  const emptyCuesCount = (project?.analysisSummary?.cues || []).filter(
    (c) => !(c.text || '').replace(/^["'\s]+|["'\s]+$/g, '').trim()
  ).length;

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
      'h-full rounded-md cursor-pointer flex items-center px-2 text-xs transition-all select-none relative ';
    if (isSelected) {
      return base + 'ring-2 ring-[#FFF5F5] shadow-lg z-20 font-semibold';
    }

    if (clip.isEmpty) {
      return (
        base +
        'bg-red-950/40 border border-dashed border-red-500/70 text-red-300 hover:border-red-400 font-mono text-[10px]'
      );
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
        <div className="flex items-center space-x-2 sm:space-x-2.5 text-xs text-[#FFF5F5]/70 shrink-0">
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

          {/* Tool Mode: Select vs Razor Cut */}
          <div className="flex items-center bg-[#222326] rounded-lg p-0.5 border border-[#393B3F]">
            <button
              onClick={() => setToolMode('select')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                timeline.toolMode === 'select'
                  ? 'bg-[#E3B5BE] text-[#18191B] font-bold shadow-sm'
                  : 'text-[#FFF5F5]/70 hover:text-white'
              }`}
              title="Select Tool (V) - Click to position playhead or drag clips"
            >
              <MousePointer className="w-3 h-3" />
              <span className="hidden sm:inline">Select</span>
            </button>
            <button
              onClick={() => {
                setToolMode('razor');
                toast.info('Razor Cut Mode: Click any clip on timeline to cut', 'Razor Tool');
              }}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                timeline.toolMode === 'razor'
                  ? 'bg-amber-400 text-black font-bold shadow-sm animate-pulse'
                  : 'text-[#FFF5F5]/70 hover:text-white'
              }`}
              title="Razor Cut Tool (C) - Click directly on any clip to cut"
            >
              <Scissors className="w-3 h-3" />
              <span className="hidden sm:inline">Razor (C)</span>
            </button>
          </div>

          {/* Razor Split Tool at Playhead */}
          <button
            onClick={handleSplitAtPlayhead}
            className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono transition-colors shrink-0 bg-[#2A2C2F] hover:bg-[#34373B] text-[#FFF5F5] border border-[#393B3F] hover:border-[#E3B5BE]/60 active:scale-95"
            title="Split Cut / Layer at Playhead (S)"
          >
            <Scissors className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span>Split (S)</span>
          </button>

          {/* Duplicate selected layer/clip button */}
          {selectedLayerIds.length > 0 && (
            <button
              onClick={handleDuplicateSelected}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#2A2C2F] hover:bg-[#34373B] text-[#FFF5F5] border border-[#393B3F] text-[11px] transition-colors shrink-0"
              title="Duplicate Selected Clip (Ctrl+D)"
            >
              <Copy className="w-3 h-3 text-[#E3B5BE]" />
              <span className="hidden sm:inline">Duplicate</span>
            </button>
          )}

          {/* + Add Track / Layer Dropdown */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsAddLayerOpen(!isAddLayerOpen);
              }}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#2A2C2F] hover:bg-[#34373B] text-[#F7D7D1] border border-[#E3B5BE]/40 text-[11px] font-mono transition-colors shrink-0"
              title="Add track or layer to timeline"
            >
              <Plus className="w-3 h-3 text-[#E3B5BE]" />
              <span>Add Clip</span>
              <ChevronDown className="w-2.5 h-2.5 opacity-60" />
            </button>

            {isAddLayerOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute left-0 top-full mt-1 w-44 bg-[#18191B] border border-[#393B3F] rounded-lg shadow-2xl py-1 z-50 animate-in fade-in zoom-in-95"
              >
                <div className="px-2.5 py-1 text-[9px] font-mono text-[#FFF5F5]/40 uppercase tracking-wider border-b border-[#393B3F]/50">
                  New Timeline Layer
                </div>
                {[
                  { id: 'overlay', label: 'B-Roll & Visual Media', icon: <ImageIcon className="w-3 h-3 text-cyan-300" /> },
                  { id: 'subtitle', label: 'Captions & Subtitles', icon: <Type className="w-3 h-3 text-[#E3B5BE]" /> },
                  { id: 'music', label: 'Audio Soundtrack', icon: <Music className="w-3 h-3 text-[#F7D7D1]" /> },
                  { id: 'audio', label: 'Audio Cleanup & Voice', icon: <Sliders className="w-3 h-3 text-emerald-300" /> },
                  { id: 'text', label: 'Graphic Text', icon: <Layers className="w-3 h-3 text-[#FFF5F5]" /> },
                  { id: 'color', label: 'Color Grade FX', icon: <Palette className="w-3 h-3 text-[#E3B5BE]" /> },
                  { id: 'cut', label: 'Razor Cut Exclude', icon: <Scissors className="w-3 h-3 text-red-300" /> },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      addTimelineLayer(item.id as any);
                      setIsAddLayerOpen(false);
                      toast.success(`Added ${item.label} to timeline`, 'Timeline');
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-[#2A2C2F] text-xs text-[#FFF5F5] flex items-center space-x-2 transition-colors"
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Magnetic Frame Snapping Toggle */}
          <button
            onClick={handleToggleSnap}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono transition-colors shrink-0 ${
              timeline.snap
                ? 'bg-[#2A2C2F] text-[#F7D7D1] border border-[#E3B5BE]/40'
                : 'bg-[#18191B] text-[#FFF5F5]/50 border border-[#393B3F] hover:text-[#FFF5F5]'
            }`}
            title="Toggle Magnetic Clip & Frame Snapping"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Snap {timeline.snap ? 'ON' : 'OFF'}</span>
          </button>

          {/* Clean empty captions button if empty cues exist */}
          {emptyCuesCount > 0 && (
            <button
              onClick={handleCleanEmptyCues}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-950/50 hover:bg-red-900/60 text-red-200 border border-red-700/60 text-[11px] transition-colors shrink-0 animate-in fade-in"
              title="Clean empty caption cue blocks"
            >
              <Trash2 className="w-3 h-3 text-red-300" />
              <span>Clean Empty ({emptyCuesCount})</span>
            </button>
          )}

          {/* Delete selected layer button */}
          {selectedLayerIds.length > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-800/50 text-[11px] transition-colors shrink-0"
              title="Delete Selected Layers or Cues (Del)"
            >
              <Trash2 className="w-3 h-3" />
              <span>Delete ({selectedLayerIds.length})</span>
            </button>
          )}
        </div>

        {/* Zoom Controls & Fit to Window */}
        <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
          <button
            onClick={handleFitToWindow}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-[#2A2C2F] hover:bg-[#34373B] text-[#FFF5F5] text-[11px] border border-[#393B3F] transition-colors"
            title="Fit timeline to window width"
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
            <span className="text-[11px] font-mono text-[#F7D7D1] px-1.5 min-w-[50px] text-center">
              {zoom}px/s
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
        {/* Track Headers (Left sidebar with Track Controls: Lock, Mute, Hide) */}
        <div className="w-48 border-r border-[#393B3F] bg-[#18191B] flex flex-col shrink-0 text-xs">
          <div className="h-6 border-b border-[#393B3F] flex items-center px-2 text-[10px] font-mono text-[#FFF5F5]/40 justify-between">
            <span>MULTI-TRACK LANES</span>
            {sceneCuts.length > 0 && (
              <span className="text-amber-400/80">{sceneCuts.length + 1} scenes</span>
            )}
          </div>
          {derivedTracks.map((track) => (
            <div
              key={track.id}
              className={`h-11 border-b border-[#393B3F] px-2.5 flex items-center justify-between text-[#FFF5F5] transition-colors ${
                track.locked
                  ? 'bg-[#121314]/80'
                  : track.hidden
                    ? 'opacity-60 bg-[#151618]'
                    : 'bg-[#18191B]'
              }`}
            >
              {/* Track Name & Icon */}
              <div className="flex items-center space-x-1.5 min-w-0 mr-1">
                {getTrackIcon(track.kind)}
                <span className="font-medium text-[11px] truncate" title={track.name}>
                  {track.name}
                </span>
              </div>

              {/* Track Controls: Hide, Mute, Lock */}
              <div className="flex items-center space-x-1 shrink-0">
                {/* Hide / Show Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    toggleTrackHidden(track.id);
                    toast.info(
                      track.hidden ? `Shown ${track.name}` : `Hidden ${track.name}`,
                      'Track Visibility'
                    );
                  }}
                  className={`p-1 rounded hover:bg-[#2A2C2F] transition-colors ${
                    track.hidden ? 'text-amber-400' : 'text-[#FFF5F5]/40 hover:text-white'
                  }`}
                  title={track.hidden ? 'Show Track' : 'Hide Track'}
                >
                  {track.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>

                {/* Mute Toggle (Audio/Music/Video) */}
                {(track.kind === 'music' || track.kind === 'video') && (
                  <button
                    type="button"
                    onClick={() => {
                      toggleTrackMute(track.id);
                      toast.info(
                        track.muted ? `Unmuted ${track.name}` : `Muted ${track.name}`,
                        'Track Audio'
                      );
                    }}
                    className={`p-1 rounded hover:bg-[#2A2C2F] transition-colors ${
                      track.muted ? 'text-red-400' : 'text-[#FFF5F5]/40 hover:text-white'
                    }`}
                    title={track.muted ? 'Unmute Track' : 'Mute Track'}
                  >
                    {track.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                  </button>
                )}

                {/* Lock Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    toggleTrackLock(track.id);
                    toast.info(
                      track.locked ? `Unlocked ${track.name}` : `Locked ${track.name}`,
                      'Track Lock'
                    );
                  }}
                  className={`p-1 rounded hover:bg-[#2A2C2F] transition-colors ${
                    track.locked ? 'text-amber-400' : 'text-[#FFF5F5]/40 hover:text-white'
                  }`}
                  title={track.locked ? 'Unlock Track' : 'Lock Track'}
                >
                  {track.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                </button>
              </div>
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
          onClick={() => {
            selectLayer(null);
            setContextMenu(null);
          }}
          className={`flex-1 overflow-x-auto relative bg-[#121314] ${
            timeline.toolMode === 'razor' ? 'cursor-crosshair' : ''
          }`}
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

              {/* Visual Scene Cut Markers on Ruler */}
              {sceneCuts.map((cutItem: any, idx: number) => {
                const cutSec =
                  typeof cutItem === 'number'
                    ? cutItem
                    : cutItem?.timeMs
                      ? cutItem.timeMs / 1000
                      : 0;
                return (
                  <div
                    key={`scene_cut_${idx}`}
                    style={{ left: `${cutSec * zoom}px` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentTime(cutSec);
                    }}
                    className="absolute top-0 bottom-0 w-1 bg-amber-400/80 hover:bg-amber-300 cursor-pointer pointer-events-auto z-20 group/scenemarker"
                    title={`Scene ${idx + 2} cut at ${cutSec.toFixed(2)}s (Click to seek)`}
                  >
                    <div className="w-2.5 h-2.5 bg-amber-400 rotate-45 -ml-[3px] -mt-1 shadow-sm opacity-80 group-hover/scenemarker:opacity-100" />
                  </div>
                );
              })}
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
                const clickedTime = calculateSnappedTime(offsetX);

                if (timeline.toolMode === 'razor') {
                  handleSplitAtPlayhead();
                  setCurrentTime(clickedTime);
                } else {
                  setCurrentTime(clickedTime);
                }

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
                <div
                  key={track.id}
                  className={`h-11 border-b border-[#393B3F]/60 relative py-1 transition-opacity ${
                    track.hidden ? 'opacity-30' : track.locked ? 'bg-[#151618]/50' : ''
                  }`}
                >
                  {track.clips.map((clip) => {
                    const isSelected = !!clip.layerId && selectedLayerIds.includes(clip.layerId);
                    const leftPx = clip.startSec * zoom;
                    const widthPx = Math.max(14, clip.durSec * zoom);

                    // Viewport culling for 500+ timeline operations scaling: skip offscreen clips
                    const viewportLeft = (timeline.scrollX || 0) - 400;
                    const viewportRight = (timeline.scrollX || 0) + (scrollContainerRef.current?.clientWidth || 1200) + 400;
                    if (!isSelected && (leftPx + widthPx < viewportLeft || leftPx > viewportRight)) {
                      return null;
                    }

                    const isEditingCue = editingTimelineCueIndex === clip.cueIndex;
                    const isEditingColor = editingTimelineColorLayerId === clip.layerId;

                    return (
                      <div
                        key={clip.id}
                        data-clip="true"
                        onMouseDown={(e) => {
                          if (e.button === 0) {
                            handleStartMoveClip(e, clip, track);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (clip.layerId) {
                            selectLayer(clip.layerId);
                          }
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            clip,
                            track,
                          });
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const container = scrollContainerRef.current;
                          let clickTime = clip.startSec;
                          if (container) {
                            const rect = container.getBoundingClientRect();
                            const offsetX = e.clientX - rect.left + container.scrollLeft;
                            clickTime = calculateSnappedTime(offsetX);
                          }

                          if (timeline.toolMode === 'razor') {
                            if (track.locked) {
                              toast.warning('Track is locked. Unlock to cut.', 'Track Locked');
                              return;
                            }
                            const splitOk = splitLayerAtTime(clickTime, clip.layerId);
                            if (splitOk) {
                              toast.success(`Razor cut at ${clickTime.toFixed(2)}s`, 'Cut');
                            }
                            setCurrentTime(clickTime);
                            return;
                          }

                          if (clip.layerId) {
                            selectLayer(clip.layerId, e.shiftKey);
                          }
                          setCurrentTime(clickTime);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (track.locked) {
                            toast.warning('Track is locked. Unlock to edit.', 'Track Locked');
                            return;
                          }
                          if (clip.cueIndex !== undefined) {
                            const cue = project?.analysisSummary?.cues?.[clip.cueIndex];
                            handleStartTimelineCueEdit(
                              clip.cueIndex,
                              cue?.text || clip.label.replace(/^"|"$/g, ''),
                              cue?.speaker || clip.speaker || 'Speaker 1'
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
                          borderLeftColor: clip.speakerColor || undefined,
                          borderLeftWidth: clip.speakerColor ? '3px' : undefined,
                        }}
                        className={`absolute top-1 bottom-1 group ${
                          isEditingCue || isEditingColor ? 'z-50 overflow-visible' : ''
                        } ${track.locked ? 'cursor-not-allowed opacity-85' : 'cursor-grab active:cursor-grabbing'} ${getClipStyle(
                          clip,
                          isSelected
                        )}`}
                        title={`${clip.label} (${clip.startSec.toFixed(2)}s - ${(clip.startSec + clip.durSec).toFixed(2)}s)${
                          clip.speaker ? ` • ${clip.speaker}` : ''
                        }${track.locked ? ' [Track Locked]' : ''}`}
                      >
                        {/* Inline Timeline Subtitle Editor Popover */}
                        {isEditingCue && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute -top-32 left-0 min-w-[290px] max-w-[420px] bg-[#18191B]/98 backdrop-blur-md border border-[#E3B5BE] rounded-xl p-3 shadow-2xl z-50 flex flex-col gap-2 animate-in fade-in zoom-in-95 pointer-events-auto"
                          >
                            <div className="flex items-center justify-between text-[11px] font-mono text-[#F7D7D1]">
                              <span className="font-semibold flex items-center space-x-1">
                                <Type className="w-3.5 h-3.5 text-[#E3B5BE]" />
                                <span>Edit Subtitle #{clip.cueIndex! + 1}</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => setEditingTimelineCueIndex(null)}
                                className="text-[#FFF5F5]/60 hover:text-white p-0.5"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Subtitle text input */}
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
                              placeholder="Type caption text..."
                              className="w-full bg-[#121314] text-[#FFF5F5] text-xs font-medium rounded-lg px-2.5 py-1.5 border border-[#393B3F] focus:border-[#E3B5BE] focus:outline-none"
                            />

                            {/* Speaker selector & timing nudges */}
                            <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                              <div className="flex items-center space-x-1.5">
                                <span className="text-[#FFF5F5]/60">Speaker:</span>
                                <input
                                  type="text"
                                  value={editingTimelineCueSpeaker}
                                  onChange={(e) => setEditingTimelineCueSpeaker(e.target.value)}
                                  className="w-24 bg-[#121314] text-[#F7D7D1] px-1.5 py-0.5 rounded border border-[#393B3F] text-[10px]"
                                  placeholder="Speaker 1"
                                />
                              </div>
                              <span className="text-[#FFF5F5]/40">
                                {clip.startSec.toFixed(2)}s - {(clip.startSec + clip.durSec).toFixed(2)}s
                              </span>
                            </div>

                            {/* Action buttons */}
                            <div className="flex items-center justify-between pt-1 border-t border-[#393B3F]/60">
                              <button
                                type="button"
                                onClick={() => handleDeleteTimelineCue(clip.cueIndex!)}
                                className="px-2 py-1 rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 text-[10px] flex items-center space-x-1 border border-red-800/40 transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
                              </button>
                              <div className="flex items-center space-x-1.5">
                                <button
                                  type="button"
                                  onClick={() => setEditingTimelineCueIndex(null)}
                                  className="px-2 py-1 rounded hover:bg-[#2A2C2F] text-[#FFF5F5]/60 text-[10px]"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveTimelineCueText(clip.cueIndex!)}
                                  className="px-3 py-1 rounded bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold text-[10px] transition-colors"
                                >
                                  Save Subtitle
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Inline Timeline Color Grade LUT & Slider Popover */}
                        {isEditingColor && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute -top-48 left-0 min-w-[320px] bg-[#18191B]/98 backdrop-blur-md border border-[#E3B5BE] rounded-xl p-3 shadow-2xl z-50 flex flex-col gap-2.5 animate-in fade-in zoom-in-95 pointer-events-auto"
                          >
                            <div className="flex items-center justify-between text-[11px] font-mono text-[#F7D7D1]">
                              <span className="flex items-center gap-1 font-semibold">
                                <Palette className="w-3.5 h-3.5 text-[#E3B5BE]" />
                                <span>Tune Color Grade & LUT Presets</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => setEditingTimelineColorLayerId(null)}
                                className="text-[#FFF5F5]/60 hover:text-white p-0.5"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* 6 Quick LUT Preset Buttons */}
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
                                      toast.success(`Set LUT to ${preset.label}`, 'Color Grade');
                                      syncColorChangesToServer();
                                    }}
                                    className={`px-1.5 py-1 rounded text-[10px] font-medium border text-center transition-all ${
                                      isActive
                                        ? 'bg-[#E3B5BE]/25 text-[#F7D7D1] border-[#E3B5BE] font-semibold shadow-sm'
                                        : 'bg-[#222326] hover:bg-[#2A2C2F] text-[#FFF5F5]/70 border-[#393B3F]'
                                    }`}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Live Sliders: Contrast, Saturation, Brightness */}
                            {(() => {
                              const resolved = resolveColorParams((clip.layerRef as any)?.params);
                              return (
                                <div className="space-y-2 bg-[#121314] p-2 rounded-lg border border-[#393B3F]/60 text-[10px]">
                                  {/* Contrast */}
                                  <div>
                                    <div className="flex items-center justify-between text-[#FFF5F5]/70 mb-0.5">
                                      <span>Contrast</span>
                                      <span className="font-mono text-[#F7D7D1]">
                                        {resolved.contrast.toFixed(2)}x
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0.7"
                                      max="1.5"
                                      step="0.05"
                                      value={resolved.contrast}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        updateDraft((d) => {
                                          const l = d.layers.find((lyr) => lyr.id === clip.layerId) as any;
                                          if (l) l.params.contrast = val;
                                        });
                                        syncColorChangesToServer();
                                      }}
                                      className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded cursor-pointer"
                                    />
                                  </div>

                                  {/* Saturation */}
                                  <div>
                                    <div className="flex items-center justify-between text-[#FFF5F5]/70 mb-0.5">
                                      <span>Saturation</span>
                                      <span className="font-mono text-[#F7D7D1]">
                                        {resolved.saturation.toFixed(2)}x
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0"
                                      max="2"
                                      step="0.05"
                                      value={resolved.saturation}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        updateDraft((d) => {
                                          const l = d.layers.find((lyr) => lyr.id === clip.layerId) as any;
                                          if (l) l.params.saturation = val;
                                        });
                                        syncColorChangesToServer();
                                      }}
                                      className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded cursor-pointer"
                                    />
                                  </div>

                                  {/* Brightness */}
                                  <div>
                                    <div className="flex items-center justify-between text-[#FFF5F5]/70 mb-0.5">
                                      <span>Brightness</span>
                                      <span className="font-mono text-[#F7D7D1]">
                                        {resolved.brightness > 0 ? '+' : ''}
                                        {resolved.brightness.toFixed(2)}
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="-0.3"
                                      max="0.3"
                                      step="0.02"
                                      value={resolved.brightness}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        updateDraft((d) => {
                                          const l = d.layers.find((lyr) => lyr.id === clip.layerId) as any;
                                          if (l) l.params.brightness = val;
                                        });
                                        syncColorChangesToServer();
                                      }}
                                      className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded cursor-pointer"
                                    />
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Action footer */}
                            <div className="flex items-center justify-between pt-1 border-t border-[#393B3F]/60 text-[10px]">
                              <button
                                type="button"
                                onClick={() => {
                                  updateDraft((d) => {
                                    const l = d.layers.find((lyr) => lyr.id === clip.layerId) as any;
                                    if (l) {
                                      l.params = { preset: 'cinematic', contrast: 1, saturation: 1, brightness: 0 };
                                    }
                                  });
                                  toast.info('Reset color grade to standard', 'Color Grade');
                                  syncColorChangesToServer();
                                }}
                                className="text-[#FFF5F5]/50 hover:text-[#FFF5F5] flex items-center space-x-1"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Reset</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingTimelineColorLayerId(null)}
                                className="px-3 py-1 rounded bg-[#E3B5BE] text-[#18191B] font-bold"
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Left Edge Trim Handle */}
                        {clip.layerId && clip.durSec >= 0.2 && !track.locked && (
                          <div
                            onMouseDown={(e) => handleStartTrim(e, clip, track, 'left')}
                            className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-[#E3B5BE] active:bg-[#F7D7D1] rounded-l flex items-center justify-center group/trim z-30 transition-colors pointer-events-auto"
                            title="Drag to trim start boundary"
                          >
                            <div className="w-0.5 h-3 bg-white/40 group-hover/trim:bg-[#18191B] rounded-full" />
                          </div>
                        )}

                        {/* Edit pencil button for subtitle cues */}
                        {clip.cueIndex !== undefined && !track.locked && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const cue = project?.analysisSummary?.cues?.[clip.cueIndex!];
                              handleStartTimelineCueEdit(
                                clip.cueIndex!,
                                cue?.text || clip.label.replace(/^"|"$/g, ''),
                                cue?.speaker || clip.speaker || 'Speaker 1'
                              );
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/20 text-[#FFF5F5] mr-1 shrink-0 z-20 pointer-events-auto"
                            title="Click or double-click to edit subtitle text"
                          >
                            <Edit3 className="w-2.5 h-2.5 text-[#E3B5BE]" />
                          </button>
                        )}

                        {/* Delete trash button directly on subtitle cue hover */}
                        {clip.cueIndex !== undefined && !track.locked && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTimelineCue(clip.cueIndex!);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/30 text-red-300 mr-1 shrink-0 z-20 pointer-events-auto"
                            title="Delete this caption cue"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        )}

                        {/* Quick LUT preset & parameter button for color clips */}
                        {clip.type === 'color' && clip.layerId && !track.locked && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectLayer(clip.layerId!);
                              setEditingTimelineColorLayerId(
                                editingTimelineColorLayerId === clip.layerId ? null : (clip.layerId || null)
                              );
                            }}
                            className="p-0.5 rounded hover:bg-white/20 text-[#FFF5F5] mr-1 shrink-0 z-20 pointer-events-auto"
                            title="Click or double-click to adjust color grade & LUT"
                          >
                            <Palette className="w-3 h-3 text-[#E3B5BE]" />
                          </button>
                        )}

                        {/* Clip label text (truncated cleanly inside span) */}
                        <span className="truncate flex-1 min-w-0 px-1 pointer-events-none">
                          {clip.label}
                        </span>

                        {/* Right Edge Trim Handle */}
                        {clip.layerId && clip.durSec >= 0.2 && !track.locked && (
                          <div
                            onMouseDown={(e) => handleStartTrim(e, clip, track, 'right')}
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

                        {/* Floating Move Timecode Badge */}
                        {activeMove && activeMove.clipId === (clip.layerId || clip.id) && (
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-amber-400 text-black font-bold text-[10px] font-mono px-2.5 py-0.5 rounded shadow-xl z-50 pointer-events-none whitespace-nowrap animate-in zoom-in-95">
                            Moving: {activeMove.currentStart.toFixed(2)}s - {(activeMove.currentStart + activeMove.durSec).toFixed(2)}s
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

      {/* Clip Right-Click Context Menu */}
      {contextMenu && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 min-w-[190px] bg-[#18191B] border border-[#393B3F] rounded-xl shadow-2xl py-1.5 text-xs text-[#FFF5F5] animate-in fade-in zoom-in-95 backdrop-blur-md"
        >
          <div className="px-3 py-1 font-mono text-[10px] text-[#F7D7D1] border-b border-[#393B3F]/60 truncate font-semibold">
            {contextMenu.clip.label}
          </div>

          {/* Split at Playhead */}
          <button
            onClick={() => {
              if (contextMenu.track.locked) {
                toast.warning('Track is locked. Unlock to split.', 'Track Locked');
              } else {
                splitLayerAtTime(playback.currentTime, contextMenu.clip.layerId);
                toast.success(`Split at ${playback.currentTime.toFixed(2)}s`, 'Split');
              }
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#2A2C2F] flex items-center space-x-2 text-[#FFF5F5] transition-colors"
          >
            <Scissors className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span>Split at Playhead (S)</span>
          </button>

          {/* Duplicate Clip */}
          <button
            onClick={() => {
              if (contextMenu.track.locked) {
                toast.warning('Track is locked.', 'Track Locked');
              } else if (contextMenu.clip.cueIndex !== undefined) {
                duplicateCue(contextMenu.clip.cueIndex);
                toast.success('Duplicated subtitle cue', 'Duplicate');
              } else if (contextMenu.clip.layerId) {
                duplicateLayer(contextMenu.clip.layerId);
                toast.success('Duplicated layer', 'Duplicate');
              }
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#2A2C2F] flex items-center space-x-2 text-[#FFF5F5] transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span>Duplicate Clip (Ctrl+D)</span>
          </button>

          {/* Move to Playhead */}
          <button
            onClick={() => {
              if (contextMenu.track.locked) {
                toast.warning('Track is locked.', 'Track Locked');
              } else {
                const targetStart = playback.currentTime;
                const targetEnd = targetStart + contextMenu.clip.durSec;
                moveClip(
                  contextMenu.clip.layerId || contextMenu.clip.id,
                  targetStart,
                  targetEnd,
                  contextMenu.clip.cueIndex !== undefined,
                  contextMenu.clip.cueIndex
                );
                toast.success(`Moved clip to ${targetStart.toFixed(2)}s`, 'Timeline');
              }
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#2A2C2F] flex items-center space-x-2 text-[#FFF5F5] transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span>Move to Playhead</span>
          </button>

          {/* Edit Properties */}
          <button
            onClick={() => {
              if (contextMenu.clip.cueIndex !== undefined) {
                const cue = project?.analysisSummary?.cues?.[contextMenu.clip.cueIndex];
                handleStartTimelineCueEdit(
                  contextMenu.clip.cueIndex,
                  cue?.text || contextMenu.clip.label.replace(/^"|"$/g, ''),
                  cue?.speaker || contextMenu.clip.speaker || 'Speaker 1'
                );
              } else if (contextMenu.clip.layerId) {
                selectLayer(contextMenu.clip.layerId);
                if (contextMenu.clip.type === 'color') {
                  setEditingTimelineColorLayerId(contextMenu.clip.layerId);
                }
              }
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#2A2C2F] flex items-center space-x-2 text-[#FFF5F5] transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span>Edit Properties</span>
          </button>

          {/* Delete Clip */}
          <button
            onClick={() => {
              if (contextMenu.track.locked) {
                toast.warning('Track is locked. Unlock to delete.', 'Track Locked');
              } else if (contextMenu.clip.cueIndex !== undefined) {
                deleteCue(contextMenu.clip.cueIndex);
                toast.info('Deleted subtitle cue', 'Captions');
              } else if (contextMenu.clip.layerId) {
                selectLayer(contextMenu.clip.layerId);
                deleteSelectedLayers();
              }
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-red-500/20 flex items-center space-x-2 text-red-300 transition-colors border-t border-[#393B3F]/60 mt-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Clip (Del)</span>
          </button>
        </div>
      )}
    </div>
  );
};
