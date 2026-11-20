import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Sliders,
  Palette,
  Type,
  Volume2,
  Layers,
  Check,
  AlertTriangle,
  Loader2,
  Trash2,
  Eye,
  EyeOff,
  Plus,
  Scissors,
  Gauge,
  Sparkles,
  ArrowRight,
  Film,
  RefreshCw,
  PlayCircle,
  FileText,
  Search,
  Clock,
  ChevronDown,
  ChevronUp,
  Minus,
} from 'lucide-react';
import { compare, Operation, applyPatch } from 'fast-json-patch';
import { rebasePlanPatch } from '../../utils/planRebase';
import {
  computeNaturalWordTimings,
  nudgeWordTiming,
  detectCueOverlaps,
  resolveCueOverlaps,
  shiftAllCues,
  syncCueToPlayhead,
  computeSpeechIntervals,
  alignCuesToSpeechIntervals,
  distributeCuesAcrossSpeech,
  normalizeCuesTimebase,
} from '../../utils/subtitleTiming';
import { useEditorStore, selectEffectivePlan } from '../../stores/editorStore';
import { api } from '../../api/client';
import { toast } from '../../stores/toastStore';
import {
  ColorPreset,
  JsonPatchOperation,
  EditLayer,
  COLOR_PRESETS,
  resolveColorParams,
  getSpeakerColor,
} from '@ai-video/shared';

export const InspectorPanel: React.FC = () => {
  const {
    project,
    plan,
    updateDraft,
    commitDraft,
    setPlan,
    timeline,
    selectLayer,
    updateCues,
    setCurrentTime,
    playback,
    updateLayerRange,
  } = useEditorStore();

  const effectivePlan = useEditorStore(selectEffectivePlan);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'conflict' | 'error'>('saved');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Subtitle / Caption editing states
  const [captionSaveStatus, setCaptionSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const [subtitleSearch, setSubtitleSearch] = useState('');
  const [expandedWordCueIndex, setExpandedWordCueIndex] = useState<number | null>(null);
  const captionDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const formatCueTime = (ms: number) => {
    const totalSec = Math.max(0, ms) / 1000;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const secStr = secs < 10 ? '0' + secs.toFixed(1) : secs.toFixed(1);
    return `${mins}:${secStr}`;
  };

  const handleUpdateCueText = useCallback(
    (index: number, newText: string) => {
      if (!project) return;
      const currentCues = project.analysisSummary?.cues || [];
      const updatedCues = currentCues.map((c, i) => {
        if (i !== index) return c;
        const tokens = newText.trim().split(/\s+/).filter(Boolean);
        // Use speech-aware syllable & punctuation duration weighting to naturally match human speech
        const words = computeNaturalWordTimings(tokens, c.startMs, c.endMs, c.words as any);
        return {
          ...c,
          text: newText,
          words,
        };
      });

      updateCues(updatedCues);

      setCaptionSaveStatus('saving');
      if (captionDebounceRef.current) {
        clearTimeout(captionDebounceRef.current);
      }
      captionDebounceRef.current = setTimeout(async () => {
        try {
          await api.updateCaptions(project.id, updatedCues);
          setCaptionSaveStatus('saved');
          setTimeout(() => setCaptionSaveStatus('idle'), 2500);
        } catch (err: any) {
          console.error('Failed to sync captions:', err);
          setCaptionSaveStatus('error');
          toast.error(
            'Failed to save subtitle edits: ' + (err.message || 'Unknown error'),
            'Captions Sync'
          );
        }
      }, 600);
    },
    [project, updateCues]
  );

  const handleUpdateCueTiming = useCallback(
    (index: number, newStartSec: number, newEndSec: number) => {
      if (!project) return;
      const currentCues = project.analysisSummary?.cues || [];
      let startMs = Math.max(0, Math.round(newStartSec * 1000));
      let endMs = Math.max(startMs + 100, Math.round(newEndSec * 1000));

      // Guard: prevent user edit from overlapping with the next cue
      if (index < currentCues.length - 1) {
        const nextStart = currentCues[index + 1].startMs;
        if (endMs > nextStart - 30) {
          endMs = Math.max(startMs + 100, nextStart - 30);
        }
      }
      // Guard: prevent user edit from overlapping with the previous cue
      if (index > 0) {
        const prevEnd = currentCues[index - 1].endMs;
        if (startMs < prevEnd + 30) {
          startMs = prevEnd + 30;
          if (endMs <= startMs) endMs = startMs + 100;
        }
      }

      const updatedCues = currentCues.map((c, i) => {
        if (i !== index) return c;
        const tokens = (c.text || '').trim().split(/\s+/).filter(Boolean);
        // Proportionally scale and shift existing acoustic word timings without flattening them
        const words = computeNaturalWordTimings(tokens, startMs, endMs, c.words as any);
        return {
          ...c,
          startMs,
          endMs,
          words,
        };
      });

      updateCues(updatedCues);

      setCaptionSaveStatus('saving');
      if (captionDebounceRef.current) {
        clearTimeout(captionDebounceRef.current);
      }
      captionDebounceRef.current = setTimeout(async () => {
        try {
          await api.updateCaptions(project.id, updatedCues);
          setCaptionSaveStatus('saved');
          setTimeout(() => setCaptionSaveStatus('idle'), 2500);
        } catch (err: any) {
          console.error('Failed to sync captions:', err);
          setCaptionSaveStatus('error');
        }
      }, 600);
    },
    [project, updateCues]
  );

  const handleNudgeWord = useCallback(
    (cueIdx: number, wordIdx: number, deltaMs: number) => {
      if (!project) return;
      const currentCues = project.analysisSummary?.cues || [];
      const cue = currentCues[cueIdx];
      if (!cue) return;

      const tokens = (cue.text || '').trim().split(/\s+/).filter(Boolean);
      const words = (
        cue.words && cue.words.length > 0
          ? cue.words
          : computeNaturalWordTimings(tokens, cue.startMs, cue.endMs)
      ) as any[];

      const nudged = nudgeWordTiming(words as any, wordIdx, deltaMs, cue.startMs, cue.endMs);
      const updatedCues = currentCues.map((c, i) => (i === cueIdx ? { ...c, words: nudged } : c));

      updateCues(updatedCues);
      setCaptionSaveStatus('saving');
      if (captionDebounceRef.current) clearTimeout(captionDebounceRef.current);
      captionDebounceRef.current = setTimeout(async () => {
        try {
          await api.updateCaptions(project.id, updatedCues);
          setCaptionSaveStatus('saved');
          setTimeout(() => setCaptionSaveStatus('idle'), 2500);
        } catch (err: any) {
          setCaptionSaveStatus('error');
        }
      }, 500);
    },
    [project, updateCues]
  );

  const handleSyncWordToPlayhead = useCallback(
    (cueIdx: number, wordIdx: number) => {
      if (!project) return;
      const currentCues = project.analysisSummary?.cues || [];
      const cue = currentCues[cueIdx];
      if (!cue) return;

      const playheadMs = Math.round(playback.currentTime * 1000);
      const tokens = (cue.text || '').trim().split(/\s+/).filter(Boolean);
      const words = (
        cue.words && cue.words.length > 0
          ? cue.words
          : computeNaturalWordTimings(tokens, cue.startMs, cue.endMs)
      ) as any[];

      const targetWord = words[wordIdx];
      if (!targetWord) return;

      const currentStart = targetWord.startMs ?? targetWord.s ?? cue.startMs;
      const delta = playheadMs - currentStart;
      const nudged = nudgeWordTiming(words as any, wordIdx, delta, cue.startMs, cue.endMs);
      const updatedCues = currentCues.map((c, i) => (i === cueIdx ? { ...c, words: nudged } : c));

      updateCues(updatedCues);
      toast.success(
        `Synced "${targetWord.word || targetWord.w}" to ${(playheadMs / 1000).toFixed(2)}s`,
        'Word Synced'
      );

      api.updateCaptions(project.id, updatedCues).catch(() => {});
    },
    [project, playback.currentTime, updateCues]
  );

  const handleAddCueLine = useCallback(() => {
    if (!project) return;
    const currentCues = [...(project.analysisSummary?.cues || [])];
    const playheadMs = Math.round(playback.currentTime * 1000);
    const startMs = playheadMs;
    const endMs = playheadMs + 2500;
    const newCue = {
      id: `cue_user_${Date.now()}`,
      startMs,
      endMs,
      text: 'New subtitle text',
      words: [
        { word: 'New', startMs, endMs: startMs + 800, score: 1 },
        { word: 'subtitle', startMs: startMs + 800, endMs: startMs + 1600, score: 1 },
        { word: 'text', startMs: startMs + 1600, endMs, score: 1 },
      ],
    };

    currentCues.push(newCue);
    currentCues.sort((a, b) => a.startMs - b.startMs);

    updateCues(currentCues);
    toast.success('Added new subtitle line', 'Captions');

    api
      .updateCaptions(project.id, currentCues)
      .then(() => {
        setCaptionSaveStatus('saved');
        setTimeout(() => setCaptionSaveStatus('idle'), 2500);
      })
      .catch((err) => {
        console.error('Failed to save added cue:', err);
        setCaptionSaveStatus('error');
      });
  }, [project, playback.currentTime, updateCues]);

  const handleDeleteCueLine = useCallback(
    (index: number) => {
      if (!project) return;
      const currentCues = project.analysisSummary?.cues || [];
      const updatedCues = currentCues.filter((_, i) => i !== index);

      updateCues(updatedCues);
      toast.info('Removed subtitle line', 'Captions');

      api
        .updateCaptions(project.id, updatedCues)
        .then(() => {
          setCaptionSaveStatus('saved');
          setTimeout(() => setCaptionSaveStatus('idle'), 2500);
        })
        .catch((err) => {
          console.error('Failed to save deleted cue:', err);
          setCaptionSaveStatus('error');
        });
    },
    [project, updateCues]
  );

  const cues = project?.analysisSummary?.cues || [];
  const videoDurationSec = playback.duration || project?.durationSec || 0;
  const videoDurationMs = videoDurationSec > 0 ? Math.round(videoDurationSec * 1000) : 0;
  const maxCueMs = cues.length > 0 ? Math.max(...cues.map((c) => c.endMs || 0)) : 0;
  const hasDurationDrift = videoDurationMs > 5000 && maxCueMs > videoDurationMs + 2000;
  const isCollapsed =
    videoDurationMs > 15000 && maxCueMs > 0 && maxCueMs < videoDurationMs * 0.25 && cues.length >= 3;
  const overlappingCues = detectCueOverlaps(cues);
  const hasOverlaps = overlappingCues.length > 0;

  const handleDistributeAcrossSpeech = useCallback(() => {
    if (!project || !cues.length || !videoDurationMs) return;
    const rawSilences = project.analysisSummary?.silences || [];
    const speechSegments = computeSpeechIntervals(
      videoDurationMs,
      rawSilences.map((s) => ({ startMs: s.startMs, endMs: s.endMs }))
    );
    const distributed = distributeCuesAcrossSpeech(cues, speechSegments, videoDurationMs);
    updateCues(distributed);
    toast.success('Paced and synchronized all dialogue cues across video speech', 'Captions Pacing');

    setCaptionSaveStatus('saving');
    api
      .updateCaptions(project.id, distributed)
      .then(() => {
        setCaptionSaveStatus('saved');
        setTimeout(() => setCaptionSaveStatus('idle'), 2500);
      })
      .catch((err) => {
        console.error('Failed to save distributed cues:', err);
        setCaptionSaveStatus('error');
        toast.error('Failed to save paced subtitles: ' + (err.message || 'Unknown error'));
      });
  }, [project, cues, videoDurationMs, updateCues]);

  const handleResolveOverlaps = useCallback(() => {
    if (!project || !cues.length) return;
    const resolved = resolveCueOverlaps(cues, 30);
    updateCues(resolved);
    toast.success('Cleanly separated overlapping subtitle lines', 'Captions Overlaps');

    setCaptionSaveStatus('saving');
    api
      .updateCaptions(project.id, resolved)
      .then(() => {
        setCaptionSaveStatus('saved');
        setTimeout(() => setCaptionSaveStatus('idle'), 2500);
      })
      .catch((err) => {
        console.error('Failed to save resolved overlaps:', err);
        setCaptionSaveStatus('error');
        toast.error('Failed to save resolved subtitles: ' + (err.message || 'Unknown error'));
      });
  }, [project, cues, updateCues]);

  const handleCalibrateTimingsToVideo = useCallback(() => {
    if (!project || !videoDurationMs || maxCueMs <= 0) return;
    const scale = videoDurationMs / maxCueMs;
    const currentCues = project.analysisSummary?.cues || [];
    const calibratedCues = currentCues.map((c) => {
      const startMs = Math.round(c.startMs * scale);
      const endMs = Math.min(videoDurationMs, Math.max(startMs + 100, Math.round(c.endMs * scale)));
      const words = (c.words || []).map((w: any) => {
        const s = Math.round((w.s ?? w.startMs ?? c.startMs) * scale);
        const rawE = Math.round((w.e ?? w.endMs ?? c.endMs) * scale);
        const e = Math.min(videoDurationMs, Math.max(s + 50, rawE));
        return {
          ...w,
          s,
          e,
          startMs: s,
          endMs: e,
        };
      });
      return {
        ...c,
        startMs,
        endMs,
        words,
      };
    });

    const nonOverlappingCues = resolveCueOverlaps(calibratedCues, 30);

    updateCues(nonOverlappingCues);
    toast.success(
      `Synchronized subtitles to video duration (${formatCueTime(videoDurationMs)})`,
      'Captions Calibrated'
    );

    setCaptionSaveStatus('saving');
    api
      .updateCaptions(project.id, nonOverlappingCues)
      .then(() => {
        setCaptionSaveStatus('saved');
        setTimeout(() => setCaptionSaveStatus('idle'), 2500);
      })
      .catch((err) => {
        console.error('Failed to save calibrated cues:', err);
        setCaptionSaveStatus('error');
        toast.error('Failed to save calibrated subtitles: ' + (err.message || 'Unknown error'));
      });
  }, [project, videoDurationMs, maxCueMs, updateCues]);

  const handleShiftAllCues = useCallback(
    (deltaSec: number) => {
      if (!project || !cues.length) return;
      const deltaMs = Math.round(deltaSec * 1000);
      const shifted = shiftAllCues(cues, deltaMs, videoDurationMs);
      updateCues(shifted);
      toast.success(
        `Shifted all subtitles by ${deltaSec > 0 ? '+' : ''}${deltaSec.toFixed(1)}s`,
        'Captions Timing'
      );

      setCaptionSaveStatus('saving');
      api
        .updateCaptions(project.id, shifted)
        .then(() => {
          setCaptionSaveStatus('saved');
          setTimeout(() => setCaptionSaveStatus('idle'), 2500);
        })
        .catch((err) => {
          console.error('Failed to save shifted cues:', err);
          setCaptionSaveStatus('error');
          toast.error('Failed to save shifted subtitles: ' + (err.message || 'Unknown error'));
        });
    },
    [project, cues, videoDurationMs, updateCues]
  );

  const handleSyncCueToPlayhead = useCallback(
    (targetIdx: number, shiftFollowing: boolean = false) => {
      if (!project || !cues.length || targetIdx < 0 || targetIdx >= cues.length) return;
      const playheadMs = Math.round(playback.currentTime * 1000);
      const synced = syncCueToPlayhead(cues, targetIdx, playheadMs, shiftFollowing);
      updateCues(synced);
      toast.success(
        shiftFollowing
          ? `Synced line ${targetIdx + 1} & all following lines to ${formatCueTime(playheadMs)}`
          : `Synced line ${targetIdx + 1} to playhead (${formatCueTime(playheadMs)})`,
        'Captions Synced'
      );

      setCaptionSaveStatus('saving');
      api
        .updateCaptions(project.id, synced)
        .then(() => {
          setCaptionSaveStatus('saved');
          setTimeout(() => setCaptionSaveStatus('idle'), 2500);
        })
        .catch((err) => {
          console.error('Failed to save synced cue:', err);
          setCaptionSaveStatus('error');
          toast.error('Failed to save synced subtitles: ' + (err.message || 'Unknown error'));
        });
    },
    [project, cues, playback.currentTime, updateCues]
  );

  const handleAcousticSnap = useCallback(() => {
    if (!project || !cues.length) return;
    const rawSilences = project.analysisSummary?.silences || [];
    const speechSegments = computeSpeechIntervals(
      videoDurationMs || 60000,
      rawSilences.map((s) => ({ startMs: s.startMs, endMs: s.endMs }))
    );

    if (speechSegments.length === 0) {
      toast.info('No distinct silence intervals detected in audio track', 'Acoustic Alignment');
      return;
    }

    const aligned = alignCuesToSpeechIntervals(cues, speechSegments);
    updateCues(aligned);
    toast.success(
      'Acoustically aligned all subtitles to physical vocal speech',
      'Acoustic Alignment'
    );

    setCaptionSaveStatus('saving');
    api
      .updateCaptions(project.id, aligned)
      .then(() => {
        setCaptionSaveStatus('saved');
        setTimeout(() => setCaptionSaveStatus('idle'), 2500);
      })
      .catch((err) => {
        console.error('Failed to save acoustically aligned cues:', err);
        setCaptionSaveStatus('error');
        toast.error('Failed to save aligned subtitles: ' + (err.message || 'Unknown error'));
      });
  }, [project, cues, videoDurationMs, updateCues]);

  // Selected layer derived from timeline selection or default to first layer
  const selectedLayerId = timeline.selectedLayerIds[0] || effectivePlan?.layers[0]?.id;
  const activeLayer = effectivePlan?.layers.find((l) => l.id === selectedLayerId);
  const selectedCueIndex = cues.findIndex(
    (c, idx) => (c.id || `cue_${idx + 1}`) === selectedLayerId || `cue_${idx}` === selectedLayerId
  );
  const selectedCue = selectedCueIndex !== -1 ? cues[selectedCueIndex] : null;

  // Debounced RFC 6902 Sync with Optimistic Concurrency Handling
  const syncDraftToServer = useCallback(async () => {
    if (!project || !plan.current || !plan.draft) return;

    try {
      const patch: Operation[] = compare(plan.current, plan.draft);

      if (patch.length === 0) {
        setSaveStatus('saved');
        return;
      }

      setSaveStatus('saving');
      setStatusMessage('Syncing changes...');

      let activeBaseVersion = plan.version;
      if (
        project.headVersion !== undefined &&
        project.headVersion !== null &&
        plan.version < project.headVersion
      ) {
        try {
          const revertRes = await api.revertPlan(project.id, plan.version);
          if (revertRes?.version) {
            activeBaseVersion = revertRes.version;
            if (revertRes.plan) {
              setPlan(revertRes.plan);
            }
          }
        } catch (revertErr) {
          console.warn('[InspectorPanel] Pre-patch revert notice:', revertErr);
        }
      }

      const response = await api.patchPlan(project.id, activeBaseVersion, {
        patch: patch as JsonPatchOperation[],
        baseVersion: activeBaseVersion,
      });

      commitDraft(response.plan);
      setSaveStatus('saved');
      setStatusMessage('All changes saved');
      toast.success(`Inspector parameters saved (v${response.plan.version})`, 'Sequence Updated');
    } catch (err: any) {
      console.error('Patch plan failed:', err);

      const isConflict =
        err.status === 409 ||
        err.statusCode === 409 ||
        err.code === 'VERSION_CONFLICT' ||
        (err.message &&
          (err.message.includes('stale base version') ||
            err.message.includes('Latest is') ||
            err.message.includes('Conflict') ||
            err.message.includes('conflict') ||
            err.message.includes('409')));

      if (isConflict) {
        setSaveStatus('conflict');
        setStatusMessage('Syncing with latest server version...');
        toast.warning('Version conflict detected, re-syncing with server...', 'Version Conflict');

        try {
          const latest = await api.getProject(project.id);
          const headV =
            latest.project?.headVersion && latest.project.headVersion > 0
              ? latest.project.headVersion
              : latest.headVersion && latest.headVersion > 0
                ? latest.headVersion
                : plan.version && plan.version > 0
                  ? plan.version
                  : 1;
          const truePlan =
            latest.plan || (headV > 0 ? (await api.getPlanVersion(project.id, headV))?.plan : null);
          if (truePlan) {
            // Attempt smart optimistic rebase of user's local edits onto the newer head plan
            let rebaseSuccess = false;
            const rebase = rebasePlanPatch(plan.current, plan.draft, truePlan);

            if (rebase.success && rebase.rebasedPatch && rebase.rebasedPatch.length > 0) {
              try {
                const rebaseRes = await api.patchPlan(project.id, headV, {
                  patch: rebase.rebasedPatch as JsonPatchOperation[],
                  baseVersion: headV,
                });
                commitDraft(rebaseRes.plan);
                setSaveStatus('saved');
                setStatusMessage(`Auto-synced to v${rebaseRes.plan.version}`);
                toast.success(`Auto-synced to v${rebaseRes.plan.version}`, 'Rebased');
                setTimeout(() => setStatusMessage('All changes saved'), 2500);
                rebaseSuccess = true;
              } catch (rebaseErr) {
                console.warn(
                  'Could not cleanly apply rebased patch onto latest plan, falling back to server state:',
                  rebaseErr
                );
              }
            } else if (rebase.success && rebase.rebasedPatch?.length === 0) {
              commitDraft(truePlan);
              setSaveStatus('saved');
              setStatusMessage('All changes saved');
              rebaseSuccess = true;
            }

            if (!rebaseSuccess) {
              setPlan(truePlan);
              setSaveStatus('saved');
              setStatusMessage(`Synchronized with v${headV}`);
              toast.info(`Synchronized with v${headV}`, 'State Refreshed');
              setTimeout(() => setStatusMessage('All changes saved'), 2500);
            }
          }
        } catch (fetchErr) {
          console.error('Failed to reload head version after conflict:', fetchErr);
          setSaveStatus('error');
          setStatusMessage('Version mismatch. Click "Sync" to reload.');
          toast.error('Version mismatch. Click "Sync" to reload.', 'Sync Error');
        }
      } else {
        setSaveStatus('error');
        setStatusMessage(err.message || 'Failed to save');
        toast.error(err.message || 'Failed to save changes', 'Save Error');
      }
    }
  }, [project, plan.current, plan.draft, plan.version, commitDraft, setPlan]);

  const handleForceSync = async () => {
    if (!project) return;
    setSaveStatus('saving');
    setStatusMessage('Syncing to latest version...');
    try {
      const latest = await api.getProject(project.id);
      const headV =
        latest.project?.headVersion && latest.project.headVersion > 0
          ? latest.project.headVersion
          : latest.headVersion && latest.headVersion > 0
            ? latest.headVersion
            : plan.version && plan.version > 0
              ? plan.version
              : 1;
      const truePlan =
        latest.plan || (headV > 0 ? (await api.getPlanVersion(project.id, headV))?.plan : null);
      if (truePlan) {
        setPlan(truePlan);
        setSaveStatus('saved');
        setStatusMessage(`Synchronized with v${headV}`);
        toast.success(`Synchronized with v${headV}`, 'State Refreshed');
        setTimeout(() => setStatusMessage('All changes saved'), 2500);
      } else {
        setSaveStatus('error');
        setStatusMessage('No plan found on server');
        toast.error('No plan found on server', 'Sync Error');
      }
    } catch (err: any) {
      console.error('Failed to sync to latest:', err);
      setSaveStatus('error');
      setStatusMessage('Failed to sync. Please refresh page.');
      toast.error('Failed to sync. Please refresh page.', 'Sync Error');
    }
  };

  // Auto-sync on window focus if server headVersion has moved ahead
  useEffect(() => {
    const handleFocus = async () => {
      if (!project || plan.draft) return;
      try {
        const latest = await api.getProject(project.id);
        const headV = latest.project?.headVersion || latest.headVersion;
        if (headV && headV > plan.version) {
          const headPlanData = await api.getPlanVersion(project.id, headV);
          const truePlan = headPlanData?.plan || headPlanData?.data || latest.plan;
          if (truePlan) {
            setPlan(truePlan);
            setStatusMessage(`Updated to v${headV}`);
            setTimeout(() => setStatusMessage('All changes saved'), 2000);
          }
        }
      } catch {
        // Silently ignore background poll errors
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [project, plan.version, plan.draft, setPlan]);

  useEffect(() => {
    if (!plan.draft) return;

    setSaveStatus('saving');
    setStatusMessage('Unsaved draft...');

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      syncDraftToServer();
    }, 2000);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [plan.draft, syncDraftToServer]);

  // Color preset options
  const colorPresets: Array<{ id: ColorPreset; label: string }> = [
    { id: 'cinematic', label: 'Cinematic' },
    { id: 'vivid', label: 'Vivid' },
    { id: 'warm', label: 'Warm' },
    { id: 'cool', label: 'Cool' },
    { id: 'bw', label: 'B & W' },
    { id: 'faded', label: 'Faded' },
  ];

  // Helper to add any new layer to plan.draft.layers
  const handleAddLayer = (type: string) => {
    setIsAddMenuOpen(false);
    updateDraft((d) => {
      const newId = `lyr_${type}_${Date.now()}`;
      let newLayer: EditLayer;

      switch (type) {
        case 'text':
          newLayer = {
            id: newId,
            layer: 'text',
            enabled: true,
            timebase: 'source',
            range: { start: 2.0, end: 7.0 },
            params: {
              content: 'New Text Overlay',
              animation: 'fade',
              position: { x: 0.5, y: 0.5 },
              font: 'Montserrat',
              size: 42,
              color: '#FFFFFF',
            },
          };
          break;
        case 'color':
          newLayer = {
            id: newId,
            layer: 'color',
            enabled: true,
            timebase: 'global',
            params: {
              preset: 'cinematic',
              contrast: 1.15,
              saturation: 1.0,
              vignette: 0.25,
            },
          };
          break;
        case 'subtitle':
          newLayer = {
            id: newId,
            layer: 'subtitle',
            enabled: true,
            timebase: 'source',
            params: {
              style: 'word_pop',
              font: 'Montserrat',
              size: 48,
              position: 'bottom',
              primaryColor: '#FFFFFF',
              highlightColor: '#FFD84D',
              maxWordsPerLine: 4,
            },
          };
          break;
        case 'music':
          newLayer = {
            id: newId,
            layer: 'music',
            enabled: true,
            timebase: 'output',
            params: {
              trackId: 'track_lofi_01',
              volume: 0.8,
              duckUnderSpeech: true,
            },
          };
          break;
        case 'speed':
          newLayer = {
            id: newId,
            layer: 'speed',
            enabled: true,
            timebase: 'source',
            range: { start: 5.0, end: 10.0 },
            params: { factor: 1.5, keepPitch: true },
          };
          break;
        case 'transition':
          newLayer = {
            id: newId,
            layer: 'transition',
            enabled: true,
            timebase: 'source',
            range: { start: 4.75, end: 5.25 },
            params: { type: 'dissolve', duration: 0.5, at: 5.0 },
          };
          break;
        case 'intro':
          newLayer = {
            id: newId,
            layer: 'intro',
            enabled: true,
            timebase: 'output',
            range: { start: 0, end: 3.0 },
            params: {
              template: 'cinematic_minimal',
              duration: 3.0,
              text: 'MY HIGHLIGHTS',
              subtext: 'Summer Vacation',
            },
          };
          break;
        default:
          return;
      }

      d.layers.push(newLayer);
      selectLayer(newId);
    });
    toast.success(`Added ${type} layer to sequence`, 'Layer Added');
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 select-none text-xs font-sans">
      {/* Auto-Sync & Status Bar */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#18191B] border border-[#393B3F] text-[11px]">
        <span className="text-[#FFF5F5]/70 font-medium">Auto-Sync Status</span>
        <div className="flex items-center space-x-1.5 font-mono">
          {saveStatus === 'saving' && (
            <div className="flex items-center space-x-2">
              <Loader2 className="w-3 h-3 text-[#E3B5BE] animate-spin" />
              <span className="text-[#E3B5BE]">{statusMessage || 'Saving...'}</span>
              {plan.draft && (
                <button
                  onClick={() => {
                    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                    syncDraftToServer();
                  }}
                  className="px-2 py-0.5 rounded bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] text-[10px] font-sans font-bold transition-colors cursor-pointer"
                >
                  Save Now
                </button>
              )}
            </div>
          )}
          {saveStatus === 'saved' && (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Synced (v{plan.version})</span>
            </>
          )}
          {saveStatus === 'conflict' && (
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span className="text-amber-400">{statusMessage}</span>
              <button
                onClick={handleForceSync}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-sans font-medium transition-colors"
                title="Sync with server version"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>Sync</span>
              </button>
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-3 h-3 text-red-400" />
              <span className="text-red-400">{statusMessage}</span>
              <button
                onClick={handleForceSync}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] text-[10px] font-sans font-bold transition-colors"
                title="Sync with latest server version"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>Sync</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Layer Tabs / Selector Bar */}
      <div>
        <div className="flex items-center justify-between text-[#FFF5F5]/80 font-mono text-[11px] font-semibold mb-2">
          <span className="flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span className="uppercase tracking-wider">
              Inspector Layers ({effectivePlan?.layers.length || 0})
            </span>
          </span>
          <div className="relative">
            <button
              onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] text-[10px] font-bold uppercase tracking-wider transition-colors shadow-sm"
            >
              <Plus className="w-3 h-3" />
              <span>Add Layer</span>
            </button>

            {isAddMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-[#222326] border border-[#393B3F] rounded-xl shadow-xl z-50 p-1.5 space-y-0.5 text-[11px]">
                <button
                  onClick={() => handleAddLayer('text')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#2A2C2F] text-[#FFF5F5]/80 hover:text-[#FFF5F5] transition-colors flex items-center space-x-2"
                >
                  <Type className="w-3.5 h-3.5 text-[#F7D7D1]" />
                  <span>Text Overlay</span>
                </button>
                <button
                  onClick={() => handleAddLayer('color')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#2A2C2F] text-[#FFF5F5]/80 hover:text-[#FFF5F5] transition-colors flex items-center space-x-2"
                >
                  <Palette className="w-3.5 h-3.5 text-[#E3B5BE]" />
                  <span>Color LUT Grade</span>
                </button>
                <button
                  onClick={() => handleAddLayer('subtitle')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#2A2C2F] text-[#FFF5F5]/80 hover:text-[#FFF5F5] transition-colors flex items-center space-x-2"
                >
                  <Type className="w-3.5 h-3.5 text-[#F7D7D1]" />
                  <span>Subtitles</span>
                </button>
                <button
                  onClick={() => handleAddLayer('music')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#2A2C2F] text-[#FFF5F5]/80 hover:text-[#FFF5F5] transition-colors flex items-center space-x-2"
                >
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Background Music</span>
                </button>
                <button
                  onClick={() => handleAddLayer('speed')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#2A2C2F] text-[#FFF5F5]/80 hover:text-[#FFF5F5] transition-colors flex items-center space-x-2"
                >
                  <Gauge className="w-3.5 h-3.5 text-[#E3B5BE]" />
                  <span>Speed Factor</span>
                </button>
                <button
                  onClick={() => handleAddLayer('intro')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#2A2C2F] text-[#FFF5F5]/80 hover:text-[#FFF5F5] transition-colors flex items-center space-x-2"
                >
                  <Film className="w-3.5 h-3.5 text-[#F7D7D1]" />
                  <span>Intro Title Card</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Horizontal Layer Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1.5 custom-scrollbar">
          {effectivePlan?.layers.map((layer) => {
            const isSelected = layer.id === selectedLayerId;
            return (
              <button
                key={layer.id}
                onClick={() => selectLayer(layer.id)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border flex items-center space-x-1.5 shrink-0 transition-all ${
                  isSelected
                    ? 'bg-[#E3B5BE]/15 text-[#F7D7D1] border-[#E3B5BE] shadow-sm'
                    : 'bg-[#18191B] hover:bg-[#2A2C2F] text-[#FFF5F5]/70 border-[#393B3F]'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    layer.enabled ? 'bg-[#E3B5BE]' : 'bg-[#484949]'
                  }`}
                />
                <span className="capitalize">{layer.layer}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Layer-Specific Inspector Panel — Derived strictly from activeLayer */}
      {activeLayer ? (
        <div className="bg-[#18191B] p-3.5 rounded-xl border border-[#393B3F] space-y-4">
          {/* Layer Header: Name, ID, Enable/Disable, Delete */}
          <div className="flex items-center justify-between pb-2 border-b border-[#393B3F]">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-[#FFF5F5] capitalize text-xs">
                {activeLayer.layer} Layer Properties
              </span>
              <span className="font-mono text-[10px] text-[#FFF5F5]/50">({activeLayer.id})</span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  const willBeEnabled = !activeLayer.enabled;
                  updateDraft((d) => {
                    const l = d.layers.find((lyr) => lyr.id === activeLayer.id);
                    if (l) l.enabled = willBeEnabled;
                  });
                  toast.info(
                    `${activeLayer.layer} layer ${willBeEnabled ? 'enabled' : 'disabled'}`,
                    'Layer Visibility'
                  );
                }}
                className="p-1 text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors"
                title={activeLayer.enabled ? 'Disable layer' : 'Enable layer'}
              >
                {activeLayer.enabled ? (
                  <Eye className="w-3.5 h-3.5 text-[#E3B5BE]" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-[#484949]" />
                )}
              </button>

              <button
                onClick={() => {
                  const lyrName = activeLayer.layer;
                  updateDraft((d) => {
                    d.layers = d.layers.filter((lyr) => lyr.id !== activeLayer.id);
                  });
                  toast.warning(`Removed ${lyrName} layer from sequence`, 'Layer Removed');
                }}
                className="p-1 text-[#FFF5F5]/40 hover:text-red-400 transition-colors"
                title="Remove layer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 1. Color Layer Controls */}
          {activeLayer.layer === 'color' &&
            (() => {
              const resolvedColor = resolveColorParams(activeLayer.params);
              return (
                <div className="space-y-3.5">
                  {/* Color Grade Segment Timing Controls */}
                  <div className="bg-[#18191B] p-2.5 rounded-lg border border-[#393B3F] space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-mono text-[#FFF5F5]/60">
                      <span>Timeline Boundaries</span>
                      <span className="text-[#F7D7D1]">
                        Duration: {((activeLayer.range?.end ?? playback.duration ?? 60) - (activeLayer.range?.start ?? 0)).toFixed(2)}s
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-[#222326] p-2 rounded border border-[#393B3F] space-y-1">
                        <span className="text-[#FFF5F5]/60 block text-[10px] font-mono">Start (sec)</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          max={activeLayer.range?.end ?? (playback.duration || 60)}
                          value={Number((activeLayer.range?.start ?? 0).toFixed(2))}
                          onChange={(e) => {
                            const val = Math.max(0, parseFloat(e.target.value) || 0);
                            const endVal = activeLayer.range?.end ?? (playback.duration || 60);
                            updateLayerRange(activeLayer.id, val, Math.max(val + 0.1, endVal));
                          }}
                          className="w-full bg-[#18191B] border border-[#393B3F] focus:border-[#E3B5BE] rounded px-2 py-1 text-xs text-[#F7D7D1] font-mono focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const cur = Number(playback.currentTime.toFixed(2));
                            const endVal = activeLayer.range?.end ?? (playback.duration || 60);
                            updateLayerRange(activeLayer.id, cur, Math.max(cur + 0.1, endVal));
                            toast.success(`Set color start to ${cur.toFixed(2)}s (Pink Line)`, 'Color Grade Updated');
                          }}
                          className="w-full text-left text-[10px] text-[#E3B5BE] hover:underline flex items-center gap-1 font-mono pt-0.5"
                          title="Align color start to pink playhead"
                        >
                          <Clock className="w-2.5 h-2.5" />
                          <span>Set Pink Line ({playback.currentTime.toFixed(2)}s)</span>
                        </button>
                      </div>

                      <div className="bg-[#222326] p-2 rounded border border-[#393B3F] space-y-1">
                        <span className="text-[#FFF5F5]/60 block text-[10px] font-mono">End (sec)</span>
                        <input
                          type="number"
                          step="0.05"
                          min={activeLayer.range?.start ?? 0}
                          value={Number((activeLayer.range?.end ?? (playback.duration || 60)).toFixed(2))}
                          onChange={(e) => {
                            const startVal = activeLayer.range?.start ?? 0;
                            const val = Math.max(startVal + 0.1, parseFloat(e.target.value) || startVal + 1);
                            updateLayerRange(activeLayer.id, startVal, val);
                          }}
                          className="w-full bg-[#18191B] border border-[#393B3F] focus:border-[#E3B5BE] rounded px-2 py-1 text-xs text-[#F7D7D1] font-mono focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const cur = Number(playback.currentTime.toFixed(2));
                            const startVal = activeLayer.range?.start ?? 0;
                            updateLayerRange(activeLayer.id, Math.min(startVal, Math.max(0, cur - 0.1)), cur);
                            toast.success(`Set color end to ${cur.toFixed(2)}s (Pink Line)`, 'Color Grade Updated');
                          }}
                          className="w-full text-left text-[10px] text-[#E3B5BE] hover:underline flex items-center gap-1 font-mono pt-0.5"
                          title="Align color end to pink playhead"
                        >
                          <Clock className="w-2.5 h-2.5" />
                          <span>Set Pink Line ({playback.currentTime.toFixed(2)}s)</span>
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        updateLayerRange(activeLayer.id, 0, playback.duration || 60);
                        toast.success('Applied color grade to full video (0s to end)', 'Color Grade');
                      }}
                      className="w-full py-1 rounded bg-[#2A2C2F] hover:bg-[#34373B] text-[10px] font-mono text-[#FFF5F5]/70 hover:text-[#FFF5F5] transition-colors"
                    >
                      Reset to Full Video (0s - {(playback.duration || 60).toFixed(1)}s)
                    </button>
                  </div>

                  <div>
                    <label className="text-[10px] text-[#FFF5F5]/60 uppercase tracking-wide block mb-1.5 font-medium font-mono">
                      LUT Preset
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {colorPresets.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => {
                            const p = COLOR_PRESETS[preset.id];
                            updateDraft((d) => {
                              const c = d.layers.find((l) => l.id === activeLayer.id) as any;
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
                          }}
                          className={`px-2 py-1.5 rounded-lg text-[10px] font-medium border text-center transition-all ${
                            activeLayer.params?.preset === preset.id
                              ? 'bg-[#E3B5BE]/20 text-[#F7D7D1] border-[#E3B5BE] shadow-sm font-semibold'
                              : 'bg-[#222326] hover:bg-[#2A2C2F] text-[#FFF5F5]/70 border-[#393B3F]'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                      <span>Contrast</span>
                      <span className="font-mono text-[#F7D7D1]">
                        {(activeLayer.params?.contrast ?? resolvedColor.contrast).toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.70"
                      max="1.50"
                      step="0.05"
                      value={activeLayer.params?.contrast ?? resolvedColor.contrast}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        updateDraft((d) => {
                          const c = d.layers.find((l) => l.id === activeLayer.id) as any;
                          if (c) c.params.contrast = val;
                        });
                      }}
                      className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                      <span>Saturation</span>
                      <span className="font-mono text-[#F7D7D1]">
                        {(activeLayer.params?.saturation ?? resolvedColor.saturation).toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.00"
                      max="2.00"
                      step="0.05"
                      value={activeLayer.params?.saturation ?? resolvedColor.saturation}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        updateDraft((d) => {
                          const c = d.layers.find((l) => l.id === activeLayer.id) as any;
                          if (c) c.params.saturation = val;
                        });
                      }}
                      className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                      <span>Vignette Edge</span>
                      <span className="font-mono text-[#F7D7D1]">
                        {(activeLayer.params?.vignette ?? resolvedColor.vignette).toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.00"
                      max="1.00"
                      step="0.05"
                      value={activeLayer.params?.vignette ?? resolvedColor.vignette}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        updateDraft((d) => {
                          const c = d.layers.find((l) => l.id === activeLayer.id) as any;
                          if (c) c.params.vignette = val;
                        });
                      }}
                      className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                      <span>Brightness</span>
                      <span className="font-mono text-[#F7D7D1]">
                        {(activeLayer.params?.brightness ?? resolvedColor.brightness).toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="-0.50"
                      max="0.50"
                      step="0.05"
                      value={activeLayer.params?.brightness ?? resolvedColor.brightness}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        updateDraft((d) => {
                          const c = d.layers.find((l) => l.id === activeLayer.id) as any;
                          if (c) c.params.brightness = val;
                        });
                      }}
                      className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                    />
                  </div>
                </div>
              );
            })()}

          {/* 2. Subtitle Layer Controls */}
          {activeLayer.layer === 'subtitle' && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[#FFF5F5]/70 text-[11px]">Animation Style</span>
                <select
                  value={activeLayer.params?.style || 'word_pop'}
                  onChange={(e) => {
                    const style = e.target.value as any;
                    updateDraft((d) => {
                      const s = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (s) s.params.style = style;
                    });
                  }}
                  className="bg-[#222326] border border-[#393B3F] rounded-lg px-2.5 py-1 text-[#FFF5F5] text-xs focus:outline-none focus:border-[#E3B5BE] transition-colors"
                >
                  <option value="word_pop">Word-Pop</option>
                  <option value="fade">Fade In</option>
                  <option value="bounce">Bounce</option>
                  <option value="karaoke">Karaoke</option>
                  <option value="minimal">Minimal</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[#FFF5F5]/70 text-[11px]">Position</span>
                <div className="flex items-center space-x-1">
                  {(['bottom', 'center', 'top'] as const).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => {
                        updateDraft((d) => {
                          const s = d.layers.find((l) => l.id === activeLayer.id) as any;
                          if (s) s.params.position = pos;
                        });
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[10px] capitalize transition-colors ${
                        (activeLayer.params?.position || 'bottom') === pos
                          ? 'bg-[#E3B5BE]/20 text-[#F7D7D1] border border-[#E3B5BE] font-semibold'
                          : 'bg-[#222326] text-[#FFF5F5]/60 border border-[#393B3F] hover:bg-[#2A2C2F]'
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                  <span>Font Size</span>
                  <span className="font-mono text-[#F7D7D1]">
                    {activeLayer.params?.size || 48} px
                  </span>
                </div>
                <input
                  type="range"
                  min="24"
                  max="96"
                  step="2"
                  value={activeLayer.params?.size || 48}
                  onChange={(e) => {
                    const size = parseInt(e.target.value, 10);
                    updateDraft((d) => {
                      const s = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (s) s.params.size = size;
                    });
                  }}
                  className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="flex items-center justify-between bg-[#222326] p-2.5 rounded-lg border border-[#393B3F]">
                  <span className="text-[#FFF5F5]/70 text-[10px] font-mono">Primary Color</span>
                  <input
                    type="color"
                    value={activeLayer.params?.primaryColor || '#FFF5F5'}
                    onChange={(e) => {
                      const col = e.target.value;
                      updateDraft((d) => {
                        const s = d.layers.find((l) => l.id === activeLayer.id) as any;
                        if (s) s.params.primaryColor = col;
                      });
                    }}
                    className="w-5 h-5 rounded cursor-pointer border border-[#393B3F] bg-transparent"
                  />
                </div>

                <div className="flex items-center justify-between bg-[#222326] p-2.5 rounded-lg border border-[#393B3F]">
                  <span className="text-[#FFF5F5]/70 text-[10px] font-mono">Highlight Pop</span>
                  <input
                    type="color"
                    value={activeLayer.params?.highlightColor || '#F7D7D1'}
                    onChange={(e) => {
                      const col = e.target.value;
                      updateDraft((d) => {
                        const s = d.layers.find((l) => l.id === activeLayer.id) as any;
                        if (s) s.params.highlightColor = col;
                      });
                    }}
                    className="w-5 h-5 rounded cursor-pointer border border-[#393B3F] bg-transparent"
                  />
                </div>
              </div>

              {/* Dialogue & Captions In-Place Editor */}
              <div className="pt-3 border-t border-[#393B3F] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#E3B5BE]" />
                    <span className="font-semibold text-xs text-[#FFF5F5]">
                      Dialogue & Captions ({project?.analysisSummary?.cues?.length || 0})
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {captionSaveStatus === 'saving' && (
                      <span className="flex items-center space-x-1 text-[10px] text-[#E3B5BE]">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        <span>Saving...</span>
                      </span>
                    )}
                    {captionSaveStatus === 'saved' && (
                      <span className="flex items-center space-x-1 text-[10px] text-emerald-400">
                        <Check className="w-2.5 h-2.5" />
                        <span>Saved</span>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleAddCueLine}
                      className="px-2 py-0.5 rounded text-[10px] bg-[#E3B5BE]/15 hover:bg-[#E3B5BE]/25 text-[#F7D7D1] border border-[#E3B5BE]/40 flex items-center space-x-1 transition-colors"
                      title="Add a subtitle line at current playhead position"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Line</span>
                    </button>
                    {cues.length > 0 && videoDurationMs > 0 && (
                      <button
                        type="button"
                        onClick={handleCalibrateTimingsToVideo}
                        className="px-2 py-0.5 rounded text-[10px] bg-[#393B3F] hover:bg-[#484949] text-[#FFF5F5]/80 border border-[#484949] flex items-center space-x-1 transition-colors"
                        title="Synchronize all subtitle timestamps to fit video duration"
                      >
                        <RefreshCw className="w-2.5 h-2.5 text-[#E3B5BE]" />
                        <span>Fit Video</span>
                      </button>
                    )}
                    {hasOverlaps && (
                      <button
                        type="button"
                        onClick={handleResolveOverlaps}
                        className="px-2 py-0.5 rounded text-[10px] bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 flex items-center space-x-1 transition-colors"
                        title="Fix overlapping subtitle start/end times"
                      >
                        <Scissors className="w-2.5 h-2.5 text-rose-400" />
                        <span>Fix Overlaps</span>
                      </button>
                    )}
                    {cues.length > 0 && (
                      <button
                        type="button"
                        onClick={handleAcousticSnap}
                        className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 flex items-center space-x-1 transition-colors"
                        title="Acoustically snap all subtitles to physical vocal speech intervals"
                      >
                        <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                        <span>Waveform Align</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Timestamp Drift Warning & 1-Click Auto-Calibration */}
                {hasDurationDrift && (
                  <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/40 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 text-amber-300 text-xs font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Timestamp Drift Detected</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCalibrateTimingsToVideo}
                        className="px-2.5 py-1 rounded text-[11px] font-bold bg-amber-500 text-black hover:bg-amber-400 transition-colors shadow-sm"
                      >
                        Auto-Calibrate to Video ({formatCueTime(videoDurationMs)})
                      </button>
                    </div>
                    <p className="text-[10px] text-amber-200/90 leading-relaxed">
                      Subtitles extend to {formatCueTime(maxCueMs)}, but your video is{' '}
                      {formatCueTime(videoDurationMs)}. Click Auto-Calibrate to synchronously scale
                      all subtitles and words to fit your speech.
                    </p>
                  </div>
                )}

                {/* Subtitle Overlaps Warning & 1-Click Auto-Fix */}
                {hasOverlaps && (
                  <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/40 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 text-rose-300 text-xs font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span>Timing Overlaps Detected ({overlappingCues.length})</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleResolveOverlaps}
                        className="px-2.5 py-1 rounded text-[11px] font-bold bg-rose-500 text-white hover:bg-rose-600 transition-colors shadow-sm"
                      >
                        Auto-Fix Overlaps
                      </button>
                    </div>
                    <p className="text-[10px] text-rose-200/90 leading-relaxed">
                      {overlappingCues.length} subtitle lines overlap in time (e.g.{' '}
                      {formatCueTime(cues[overlappingCues[0].index].startMs)} ends at{' '}
                      {formatCueTime(cues[overlappingCues[0].index].endMs)}, after line{' '}
                      {overlappingCues[0].index + 2} starts at{' '}
                      {formatCueTime(overlappingCues[0].nextStartMs)}). This causes double text on
                      video. Click <strong>Auto-Fix Overlaps</strong> to separate them.
                    </p>
                  </div>
                )}

                {/* Collapsed Subtitles Warning (spanned < 25% of video) & 1-Click Speech Calibration */}
                {isCollapsed && (
                  <div className="p-2.5 rounded-lg bg-indigo-500/15 border border-indigo-500/40 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 text-indigo-300 text-xs font-semibold">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span>Timing Mismatch Detected (Collapsed Subtitles)</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleDistributeAcrossSpeech}
                        className="px-2.5 py-1 rounded text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-400 transition-colors shadow-sm"
                      >
                        Sync to Spoken Voice
                      </button>
                    </div>
                    <p className="text-[10px] text-indigo-200/90 leading-relaxed">
                      Your {cues.length} subtitle cues only span {formatCueTime(maxCueMs)}, while your video is{' '}
                      {formatCueTime(videoDurationMs)}. Click <strong>Sync to Spoken Voice</strong> to automatically
                      align and pace all dialogue lines and words across your video's audio waveform.
                    </p>
                  </div>
                )}

                {/* Search bar if multiple cues */}
                {(project?.analysisSummary?.cues?.length || 0) > 3 && (
                  <div className="relative">
                    <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#FFF5F5]/40" />
                    <input
                      type="text"
                      placeholder="Search subtitles..."
                      value={subtitleSearch}
                      onChange={(e) => setSubtitleSearch(e.target.value)}
                      className="w-full bg-[#222326] border border-[#393B3F] rounded-lg pl-7 pr-2.5 py-1 text-[11px] text-[#FFF5F5] placeholder-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE]"
                    />
                  </div>
                )}

                {/* Global Timing Sync & Slip Toolbar */}
                {cues.length > 0 && (
                  <div className="flex items-center justify-between bg-[#1D1E20] border border-[#393B3F] rounded-lg px-2.5 py-1.5 text-[10px]">
                    <div className="flex items-center space-x-1.5 text-[#FFF5F5]/70">
                      <Clock className="w-3 h-3 text-[#E3B5BE]" />
                      <span className="font-medium">Nudge Timing:</span>
                    </div>
                    <div className="flex items-center space-x-1 font-mono">
                      <button
                        type="button"
                        onClick={() => handleShiftAllCues(-0.5)}
                        className="px-1.5 py-0.5 rounded bg-[#2A2B2E] hover:bg-[#393B3F] text-[#FFF5F5]/90 border border-[#393B3F] transition-colors"
                        title="Shift all subtitles 0.5s earlier (if text appears after voice)"
                      >
                        -0.5s
                      </button>
                      <button
                        type="button"
                        onClick={() => handleShiftAllCues(-0.1)}
                        className="px-1.5 py-0.5 rounded bg-[#2A2B2E] hover:bg-[#393B3F] text-[#FFF5F5]/90 border border-[#393B3F] transition-colors"
                        title="Shift all subtitles 0.1s earlier"
                      >
                        -0.1s
                      </button>
                      <button
                        type="button"
                        onClick={() => handleShiftAllCues(0.1)}
                        className="px-1.5 py-0.5 rounded bg-[#2A2B2E] hover:bg-[#393B3F] text-[#FFF5F5]/90 border border-[#393B3F] transition-colors"
                        title="Shift all subtitles 0.1s later"
                      >
                        +0.1s
                      </button>
                      <button
                        type="button"
                        onClick={() => handleShiftAllCues(0.5)}
                        className="px-1.5 py-0.5 rounded bg-[#2A2B2E] hover:bg-[#393B3F] text-[#FFF5F5]/90 border border-[#393B3F] transition-colors"
                        title="Shift all subtitles 0.5s later (if text appears before voice)"
                      >
                        +0.5s
                      </button>
                    </div>
                  </div>
                )}

                {/* Subtitle Cue Cards List */}
                <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                  {!project?.analysisSummary?.cues || project.analysisSummary.cues.length === 0 ? (
                    <div className="text-center py-4 px-3 bg-[#222326] rounded-lg border border-[#393B3F] space-y-1.5">
                      <p className="text-[11px] text-[#FFF5F5]/70">
                        No subtitle lines detected or added.
                      </p>
                      <button
                        type="button"
                        onClick={handleAddCueLine}
                        className="px-3 py-1 rounded-lg text-xs bg-[#E3B5BE] text-[#18191B] font-medium hover:bg-[#E3B5BE]/90 transition-colors"
                      >
                        + Add First Subtitle Line
                      </button>
                    </div>
                  ) : (
                    project.analysisSummary.cues
                      .map((cue, origIdx) => ({ cue, origIdx }))
                      .filter(({ cue }) =>
                        subtitleSearch
                          ? cue.text.toLowerCase().includes(subtitleSearch.toLowerCase())
                          : true
                      )
                      .map(({ cue, origIdx }) => {
                        const curMs = Math.round(playback.currentTime * 1000);
                        const isCurrent = curMs >= cue.startMs && curMs <= cue.endMs;
                        const nextCue = project?.analysisSummary?.cues?.[origIdx + 1];
                        const hasOverlapWithNext = nextCue && cue.endMs > nextCue.startMs;
                        const overlapSec = hasOverlapWithNext
                          ? ((cue.endMs - nextCue.startMs) / 1000).toFixed(1)
                          : '0.0';

                        return (
                          <div
                            key={cue.id || origIdx}
                            className={`p-2 rounded-lg border transition-all ${
                              hasOverlapWithNext
                                ? 'bg-[#222326] border-rose-500/50 hover:border-rose-500/80'
                                : isCurrent
                                  ? 'bg-[#E3B5BE]/10 border-[#E3B5BE] shadow-sm'
                                  : 'bg-[#222326] border-[#393B3F] hover:border-[#484949]'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                                <button
                                  type="button"
                                  onClick={() => setCurrentTime(cue.startMs / 1000)}
                                  className={`flex items-center space-x-1 font-mono text-[10px] hover:underline ${
                                    isCurrent ? 'text-[#F7D7D1] font-semibold' : 'text-[#FFF5F5]/60'
                                  }`}
                                  title="Click to seek player here"
                                >
                                  <PlayCircle className="w-3 h-3 text-[#E3B5BE]" />
                                  <span>
                                    {formatCueTime(cue.startMs)} - {formatCueTime(cue.endMs)}
                                  </span>
                                </button>
                                {hasOverlapWithNext && (
                                  <span className="text-[9px] font-mono text-rose-300 px-1 py-0.2 rounded bg-rose-500/20 border border-rose-500/30">
                                    Overlap +{overlapSec}s
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center space-x-1.5">
                                {isCurrent && (
                                  <span className="text-[9px] font-mono uppercase tracking-wider text-[#E3B5BE] px-1 py-0.2 rounded bg-[#E3B5BE]/20">
                                    Playing
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCueLine(origIdx)}
                                  className="text-[#FFF5F5]/30 hover:text-red-400 p-0.5 transition-colors"
                                  title="Delete subtitle line"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

                            <textarea
                              rows={2}
                              value={cue.text || (cue.words && cue.words.map((w: any) => w.word || w.w).join(' ')) || ''}
                              onChange={(e) => handleUpdateCueText(origIdx, e.target.value)}
                              placeholder="Subtitle text..."
                              className="w-full bg-[#18191B] border border-[#393B3F] focus:border-[#E3B5BE] rounded p-1.5 text-xs text-[#FFF5F5] placeholder-[#FFF5F5]/30 resize-none focus:outline-none transition-colors"
                            />

                            {/* Timing Adjusters */}
                            <div className="flex items-center justify-between mt-1 pt-1 border-t border-[#393B3F]/50 text-[10px] text-[#FFF5F5]/50 font-mono">
                              <div className="flex items-center space-x-1">
                                <span>Start:</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  value={(cue.startMs / 1000).toFixed(1)}
                                  onChange={(e) =>
                                    handleUpdateCueTiming(
                                      origIdx,
                                      parseFloat(e.target.value) || 0,
                                      cue.endMs / 1000
                                    )
                                  }
                                  className="w-16 min-w-[62px] bg-[#18191B] border border-[#393B3F] rounded px-1.5 py-0.5 text-center text-[#FFF5F5] focus:outline-none focus:border-[#E3B5BE]"
                                />
                                <span>s</span>
                              </div>
                              <div className="flex items-center space-x-1">
                                <span>End:</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0.1"
                                  value={(cue.endMs / 1000).toFixed(1)}
                                  onChange={(e) =>
                                    handleUpdateCueTiming(
                                      origIdx,
                                      cue.startMs / 1000,
                                      parseFloat(e.target.value) || 0.1
                                    )
                                  }
                                  className="w-16 min-w-[62px] bg-[#18191B] border border-[#393B3F] rounded px-1.5 py-0.5 text-center text-[#FFF5F5] focus:outline-none focus:border-[#E3B5BE]"
                                />
                                <span>s</span>
                              </div>
                              <div className="flex items-center space-x-1">
                                <button
                                  type="button"
                                  onClick={() => handleSyncCueToPlayhead(origIdx, false)}
                                  className="px-1.5 py-0.5 rounded bg-[#2A2B2E] hover:bg-[#E3B5BE]/20 text-[#E3B5BE] text-[9px] border border-[#E3B5BE]/30 transition-colors"
                                  title="Snap this line's start time to current playhead position"
                                >
                                  Snap Here
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSyncCueToPlayhead(origIdx, true)}
                                  className="px-1.5 py-0.5 rounded bg-[#2A2B2E] hover:bg-[#E3B5BE]/20 text-[#FFF5F5]/70 hover:text-[#FFF5F5] text-[9px] border border-[#393B3F] transition-colors"
                                  title="Snap this line to playhead and shift all subsequent lines by the same offset"
                                >
                                  Snap & All
                                </button>
                              </div>
                            </div>

                            {/* Fine-tune Word Timings Accordion */}
                            <div className="mt-1.5 pt-1 border-t border-[#393B3F]/40">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedWordCueIndex(
                                    expandedWordCueIndex === origIdx ? null : origIdx
                                  )
                                }
                                className="flex items-center space-x-1 text-[10px] text-[#E3B5BE] hover:text-[#F7D7D1] transition-colors font-medium"
                              >
                                <Clock className="w-3 h-3" />
                                <span>
                                  {expandedWordCueIndex === origIdx ? 'Hide' : 'Fine-Tune'} Word
                                  Pacing (
                                  {cue.words?.length ||
                                    (cue.text || '').trim().split(/\s+/).filter(Boolean)
                                      .length}{' '}
                                  words)
                                </span>
                                {expandedWordCueIndex === origIdx ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </button>

                              {expandedWordCueIndex === origIdx && (
                                <div className="mt-2 space-y-1.5 bg-[#18191B]/90 p-2 rounded-lg border border-[#393B3F]/60">
                                  <div className="flex items-center justify-between text-[9px] text-[#FFF5F5]/60 mb-1">
                                    <span>
                                      Click word to seek. Use +/- or Sync to match speech:
                                    </span>
                                    <span className="font-mono text-[#F7D7D1]">
                                      Playhead: {playback.currentTime.toFixed(2)}s
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                                    {(cue.words && cue.words.length > 0
                                      ? cue.words
                                      : computeNaturalWordTimings(
                                          (cue.text || '').trim().split(/\s+/).filter(Boolean),
                                          cue.startMs,
                                          cue.endMs
                                        )
                                    ).map((w: any, wIdx: number) => {
                                      const wText = w.word || w.w || '';
                                      const wStart =
                                        (w.startMs !== undefined ? w.startMs : w.s || cue.startMs) /
                                        1000;
                                      const wStartMs = Math.round(wStart * 1000);
                                      const curPlayheadMs = Math.round(playback.currentTime * 1000);
                                      const isWordCurrentlyPlaying =
                                        curPlayheadMs >= wStartMs &&
                                        curPlayheadMs <=
                                          (w.endMs !== undefined ? w.endMs : w.e || wStartMs + 300);

                                      return (
                                        <div
                                          key={wIdx}
                                          className={`flex items-center space-x-1 px-1.5 py-1 rounded border text-[10px] font-mono transition-colors ${
                                            isWordCurrentlyPlaying
                                              ? 'bg-[#E3B5BE]/25 border-[#E3B5BE] text-[#FFF5F5]'
                                              : 'bg-[#222326] border-[#393B3F] text-[#FFF5F5]/80 hover:border-[#484949]'
                                          }`}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => setCurrentTime(wStart)}
                                            className="font-semibold text-[#FFF5F5] hover:underline max-w-[85px] truncate"
                                            title={`Click to jump video to "${wText}" (${wStart.toFixed(2)}s)`}
                                          >
                                            {wText}
                                          </button>
                                          <span className="text-[9px] text-[#F7D7D1]/70">
                                            {wStart.toFixed(2)}s
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => handleNudgeWord(origIdx, wIdx, -50)}
                                            className="p-0.5 rounded hover:bg-[#2A2C2F] text-[#FFF5F5]/60 hover:text-[#FFF5F5]"
                                            title="Nudge word 50ms earlier"
                                          >
                                            <Minus className="w-2.5 h-2.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleNudgeWord(origIdx, wIdx, 50)}
                                            className="p-0.5 rounded hover:bg-[#2A2C2F] text-[#FFF5F5]/60 hover:text-[#FFF5F5]"
                                            title="Nudge word 50ms later"
                                          >
                                            <Plus className="w-2.5 h-2.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleSyncWordToPlayhead(origIdx, wIdx)}
                                            className="px-1 py-0.5 rounded bg-[#2A2C2F] hover:bg-[#E3B5BE] hover:text-[#18191B] text-[8px] text-[#E3B5BE] transition-colors font-sans uppercase font-bold"
                                            title="Sync this word start to current video playhead"
                                          >
                                            Sync
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 3. Text Overlay Layer Controls */}
          {activeLayer.layer === 'text' && (
            <div className="space-y-3.5">
              <div>
                <label className="text-[10px] text-[#FFF5F5]/60 uppercase tracking-wide block mb-1 font-medium font-mono">
                  Overlay Text
                </label>
                <input
                  type="text"
                  value={activeLayer.params?.content || ''}
                  onChange={(e) => {
                    const text = e.target.value;
                    updateDraft((d) => {
                      const t = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (t) t.params.content = text;
                    });
                  }}
                  className="w-full bg-[#222326] border border-[#393B3F] rounded-lg px-2.5 py-1.5 text-xs text-[#FFF5F5] placeholder-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE] transition-colors"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[#FFF5F5]/70 text-[11px]">Animation</span>
                <select
                  value={activeLayer.params?.animation || 'fade'}
                  onChange={(e) => {
                    const anim = e.target.value as any;
                    updateDraft((d) => {
                      const t = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (t) t.params.animation = anim;
                    });
                  }}
                  className="bg-[#222326] border border-[#393B3F] rounded-lg px-2.5 py-1 text-[#FFF5F5] text-xs focus:outline-none focus:border-[#E3B5BE] transition-colors"
                >
                  <option value="fade">Fade</option>
                  <option value="slide_up">Slide Up</option>
                  <option value="scale">Scale</option>
                  <option value="typewriter">Typewriter</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                  <span>Font Size</span>
                  <span className="font-mono text-[#F7D7D1]">
                    {activeLayer.params?.size || 42} px
                  </span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="96"
                  step="2"
                  value={activeLayer.params?.size || 42}
                  onChange={(e) => {
                    const sz = parseInt(e.target.value, 10);
                    updateDraft((d) => {
                      const t = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (t) t.params.size = sz;
                    });
                  }}
                  className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between bg-[#222326] p-2.5 rounded-lg border border-[#393B3F]">
                <span className="text-[#FFF5F5]/70 text-[10px] font-mono">Text Color</span>
                <input
                  type="color"
                  value={activeLayer.params?.color || '#FFF5F5'}
                  onChange={(e) => {
                    const c = e.target.value;
                    updateDraft((d) => {
                      const t = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (t) t.params.color = c;
                    });
                  }}
                  className="w-5 h-5 rounded cursor-pointer border border-[#393B3F] bg-transparent"
                />
              </div>
            </div>
          )}

          {/* 4. Music Layer Controls */}
          {activeLayer.layer === 'music' && (
            <div className="space-y-3.5">
              <div>
                <label className="text-[10px] text-[#FFF5F5]/60 uppercase tracking-wide block mb-1 font-medium font-mono">
                  Licensed Music Track
                </label>
                <select
                  value={activeLayer.params?.trackId || 'mus_calm_01'}
                  onChange={(e) => {
                    const trk = e.target.value;
                    updateDraft((d) => {
                      const m = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (m) m.params.trackId = trk;
                    });
                  }}
                  className="w-full bg-[#222326] border border-[#393B3F] rounded-lg px-2.5 py-1.5 text-xs text-[#FFF5F5] focus:outline-none focus:border-[#E3B5BE] transition-colors"
                >
                  <option value="mus_calm_01">Calm Cinematic Ambient (96 BPM)</option>
                  <option value="mus_upbeat_01">Upbeat Creator Energy (128 BPM)</option>
                  <option value="mus_lofi_01">Lo-Fi Chill Hop (85 BPM)</option>
                  <option value="mus_acoustic_01">Acoustic Sunshine (110 BPM)</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[#FFF5F5]/70 text-[11px] block">Speech Ducking</span>
                  <span className="text-[10px] text-[#FFF5F5]/40">&gt;8 dB auto-attenuation</span>
                </div>
                <button
                  onClick={() => {
                    updateDraft((d) => {
                      const m = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (m) m.params.duckUnderSpeech = !m.params.duckUnderSpeech;
                    });
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    activeLayer.params?.duckUnderSpeech
                      ? 'bg-[#E3B5BE]/20 text-[#F7D7D1] border border-[#E3B5BE]/50'
                      : 'bg-[#222326] text-[#FFF5F5]/50 border border-[#393B3F]'
                  }`}
                >
                  {activeLayer.params?.duckUnderSpeech ? 'ACTIVE (-12 dB)' : 'DISABLED'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[#FFF5F5]/70 text-[11px] block">Beat Synchronization</span>
                  <span className="text-[10px] text-[#FFF5F5]/40">
                    Snap cuts to beat grid within 60ms
                  </span>
                </div>
                <button
                  onClick={() => {
                    updateDraft((d) => {
                      const m = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (m) m.params.beatSync = !m.params.beatSync;
                    });
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    activeLayer.params?.beatSync
                      ? 'bg-[#E3B5BE]/20 text-[#F7D7D1] border border-[#E3B5BE]/50'
                      : 'bg-[#222326] text-[#FFF5F5]/50 border border-[#393B3F]'
                  }`}
                >
                  {activeLayer.params?.beatSync ? 'ENABLED' : 'OFF'}
                </button>
              </div>

              <div>
                <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                  <span>Music Volume</span>
                  <span className="font-mono text-[#F7D7D1]">
                    {Math.round((activeLayer.params?.volume ?? 0.35) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={activeLayer.params?.volume ?? 0.35}
                  onChange={(e) => {
                    const vol = parseFloat(e.target.value);
                    updateDraft((d) => {
                      const m = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (m) m.params.volume = vol;
                    });
                  }}
                  className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                    <span>Fade In</span>
                    <span className="font-mono text-[#F7D7D1]">
                      {activeLayer.params?.fadeIn ?? 1.5}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.5"
                    value={activeLayer.params?.fadeIn ?? 1.5}
                    onChange={(e) => {
                      const f = parseFloat(e.target.value);
                      updateDraft((d) => {
                        const m = d.layers.find((l) => l.id === activeLayer.id) as any;
                        if (m) m.params.fadeIn = f;
                      });
                    }}
                    className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                    <span>Fade Out</span>
                    <span className="font-mono text-[#F7D7D1]">
                      {activeLayer.params?.fadeOut ?? 3.0}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.5"
                    value={activeLayer.params?.fadeOut ?? 3.0}
                    onChange={(e) => {
                      const f = parseFloat(e.target.value);
                      updateDraft((d) => {
                        const m = d.layers.find((l) => l.id === activeLayer.id) as any;
                        if (m) m.params.fadeOut = f;
                      });
                    }}
                    className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Audio Layer Controls */}
          {activeLayer.layer === 'audio' && (
            <div className="space-y-3.5">
              <div>
                <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                  <span>Loudness Target (EBU R128)</span>
                  <span className="font-mono text-[#F7D7D1]">
                    {activeLayer.params?.normalizeLufs ?? -16} LUFS
                  </span>
                </div>
                <input
                  type="range"
                  min="-23"
                  max="-14"
                  step="0.5"
                  value={activeLayer.params?.normalizeLufs ?? -16}
                  onChange={(e) => {
                    const lufs = parseFloat(e.target.value);
                    updateDraft((d) => {
                      const a = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (a) a.params.normalizeLufs = lufs;
                    });
                  }}
                  className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[#FFF5F5]/70 text-[11px] block">Background Denoise</span>
                  <span className="text-[10px] text-[#FFF5F5]/40">FFT audio filter (afftdn)</span>
                </div>
                <button
                  onClick={() => {
                    updateDraft((d) => {
                      const a = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (a) a.params.denoise = !a.params.denoise;
                    });
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    activeLayer.params?.denoise
                      ? 'bg-[#E3B5BE]/20 text-[#F7D7D1] border border-[#E3B5BE]/50'
                      : 'bg-[#222326] text-[#FFF5F5]/50 border border-[#393B3F]'
                  }`}
                >
                  {activeLayer.params?.denoise ? 'ACTIVE' : 'OFF'}
                </button>
              </div>
            </div>
          )}

          {/* 5. Cut Layer Controls */}
          {activeLayer.layer === 'cut' && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[#FFF5F5]/70 text-[11px]">Cut Reason</span>
                <span className="px-2 py-0.5 rounded bg-red-950/40 text-red-300 border border-red-800/40 text-[10px] font-mono capitalize">
                  {activeLayer.params?.reason || 'user'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-[#222326] p-2.5 rounded-lg border border-[#393B3F] space-y-1">
                  <span className="text-[#FFF5F5]/60 block text-[10px] font-mono">Start Cut (sec)</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max={activeLayer.range?.end ?? 60}
                    value={Number((activeLayer.range?.start || 0).toFixed(2))}
                    onChange={(e) => {
                      const val = Math.max(0, parseFloat(e.target.value) || 0);
                      updateLayerRange(activeLayer.id, val, activeLayer.range?.end ?? val + 1.0);
                    }}
                    className="w-full bg-[#18191B] border border-[#393B3F] focus:border-[#E3B5BE] rounded px-2 py-1 text-xs text-[#F7D7D1] font-mono focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cur = Number(playback.currentTime.toFixed(2));
                      const endVal = activeLayer.range?.end ?? cur + 1.0;
                      updateLayerRange(
                        activeLayer.id,
                        cur,
                        Math.max(cur + 0.1, endVal)
                      );
                      toast.success(
                        `Set cut start to ${cur.toFixed(2)}s (Pink Line)`,
                        'Cut Updated'
                      );
                    }}
                    className="w-full text-left text-[10px] text-[#E3B5BE] hover:underline flex items-center gap-1 font-mono pt-1"
                    title="Align cut start to current pink playhead line"
                  >
                    <Clock className="w-2.5 h-2.5" />
                    <span>Set to Pink Line ({playback.currentTime.toFixed(2)}s)</span>
                  </button>
                </div>

                <div className="bg-[#222326] p-2.5 rounded-lg border border-[#393B3F] space-y-1">
                  <span className="text-[#FFF5F5]/60 block text-[10px] font-mono">End Cut (sec)</span>
                  <input
                    type="number"
                    step="0.05"
                    min={activeLayer.range?.start ?? 0}
                    value={Number((activeLayer.range?.end || 1.0).toFixed(2))}
                    onChange={(e) => {
                      const val = Math.max((activeLayer.range?.start || 0) + 0.05, parseFloat(e.target.value) || 1.0);
                      updateLayerRange(activeLayer.id, activeLayer.range?.start || 0, val);
                    }}
                    className="w-full bg-[#18191B] border border-[#393B3F] focus:border-[#E3B5BE] rounded px-2 py-1 text-xs text-[#F7D7D1] font-mono focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cur = Number(playback.currentTime.toFixed(2));
                      const startVal = activeLayer.range?.start ?? 0;
                      updateLayerRange(
                        activeLayer.id,
                        Math.min(startVal, cur - 0.1),
                        cur
                      );
                      toast.success(
                        `Set cut end to ${cur.toFixed(2)}s (Pink Line)`,
                        'Cut Updated'
                      );
                    }}
                    className="w-full text-left text-[10px] text-[#E3B5BE] hover:underline flex items-center gap-1 font-mono pt-1"
                    title="Align cut end to current pink playhead line"
                  >
                    <Clock className="w-2.5 h-2.5" />
                    <span>Set to Pink Line ({playback.currentTime.toFixed(2)}s)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 6. Speed Layer Controls */}
          {activeLayer.layer === 'speed' && (
            <div className="space-y-3.5">
              <div>
                <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                  <span>Speed Multiplier</span>
                  <span className="font-mono text-[#F7D7D1] font-semibold">
                    {activeLayer.params?.factor ?? 1.5}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.25"
                  max="4.0"
                  step="0.25"
                  value={activeLayer.params?.factor ?? 1.5}
                  onChange={(e) => {
                    const factor = parseFloat(e.target.value);
                    updateDraft((d) => {
                      const sp = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (sp) sp.params.factor = factor;
                    });
                  }}
                  className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[#FFF5F5]/70 text-[11px]">Pitch Correction</span>
                <input
                  type="checkbox"
                  checked={activeLayer.params?.keepPitch ?? true}
                  onChange={(e) => {
                    const chk = e.target.checked;
                    updateDraft((d) => {
                      const sp = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (sp) sp.params.keepPitch = chk;
                    });
                  }}
                  className="rounded accent-[#E3B5BE] cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* 7. Intro / Outro Layer Controls */}
          {(activeLayer.layer === 'intro' || activeLayer.layer === 'outro') && (
            <div className="space-y-3.5">
              <div>
                <label className="text-[10px] text-[#FFF5F5]/60 uppercase tracking-wide block mb-1 font-medium font-mono">
                  Headline Text
                </label>
                <input
                  type="text"
                  value={activeLayer.params?.text || ''}
                  onChange={(e) => {
                    const txt = e.target.value;
                    updateDraft((d) => {
                      const card = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (card) card.params.text = txt;
                    });
                  }}
                  className="w-full bg-[#222326] border border-[#393B3F] rounded-lg px-2.5 py-1.5 text-xs text-[#FFF5F5] placeholder-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE] transition-colors"
                />
              </div>

              <div>
                <label className="text-[10px] text-[#FFF5F5]/60 uppercase tracking-wide block mb-1 font-medium font-mono">
                  Subtext
                </label>
                <input
                  type="text"
                  value={activeLayer.params?.subtext || ''}
                  onChange={(e) => {
                    const st = e.target.value;
                    updateDraft((d) => {
                      const card = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (card) card.params.subtext = st;
                    });
                  }}
                  className="w-full bg-[#222326] border border-[#393B3F] rounded-lg px-2.5 py-1.5 text-xs text-[#FFF5F5] placeholder-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE] transition-colors"
                />
              </div>

              <div>
                <div className="flex justify-between text-[#FFF5F5]/70 text-[11px] mb-1">
                  <span>Duration</span>
                  <span className="font-mono text-[#F7D7D1]">
                    {activeLayer.params?.duration ?? 3}s
                  </span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="10"
                  step="0.5"
                  value={activeLayer.params?.duration ?? 3}
                  onChange={(e) => {
                    const dur = parseFloat(e.target.value);
                    updateDraft((d) => {
                      const card = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (card) card.params.duration = dur;
                    });
                  }}
                  className="w-full accent-[#E3B5BE] h-1.5 bg-[#2A2C2F] rounded-lg cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>
      ) : selectedCue ? (
        <div className="bg-[#18191B] p-3.5 rounded-xl border border-[#393B3F] space-y-4 animate-in fade-in">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-[#393B3F]">
            <div className="flex items-center space-x-2">
              <span
                style={{ backgroundColor: getSpeakerColor(selectedCue.speaker) }}
                className="w-2.5 h-2.5 rounded-full"
              />
              <span className="font-semibold text-[#FFF5F5] text-xs">
                Subtitle Cue #{selectedCueIndex + 1}
              </span>
              <span className="font-mono text-[10px] text-[#F7D7D1]">
                ({(selectedCue.startMs / 1000).toFixed(2)}s - {(selectedCue.endMs / 1000).toFixed(2)}s)
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setCurrentTime(selectedCue.startMs / 1000)}
                className="p-1 rounded hover:bg-[#2A2C2F] text-[#E3B5BE] hover:text-[#F7D7D1] transition-colors"
                title="Seek playhead to cue start"
              >
                <PlayCircle className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleDeleteCueLine(selectedCueIndex)}
                className="p-1 rounded hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
                title="Delete this subtitle cue"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Speaker Diarization Tag */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-[#FFF5F5]/60 block">
              Speaker Diarization Tag
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={selectedCue.speaker || 'Speaker 1'}
                onChange={(e) => {
                  const newSpk = e.target.value;
                  const currentCues = project?.analysisSummary?.cues || [];
                  const updated = currentCues.map((c, i) =>
                    i === selectedCueIndex ? { ...c, speaker: newSpk } : c
                  );
                  updateCues(updated);
                  if (project) {
                    api.updateCaptions(project.id, updated).catch(() => {});
                  }
                }}
                className="flex-1 bg-[#222326] text-[#FFF5F5] text-xs px-2.5 py-1.5 rounded-lg border border-[#393B3F] focus:border-[#E3B5BE] focus:outline-none"
                placeholder="Speaker 1"
              />
              <div className="flex items-center space-x-1">
                {['Speaker 1', 'Speaker 2', 'Speaker 3'].map((spk) => (
                  <button
                    key={spk}
                    type="button"
                    onClick={() => {
                      const currentCues = project?.analysisSummary?.cues || [];
                      const updated = currentCues.map((c, i) =>
                        i === selectedCueIndex ? { ...c, speaker: spk } : c
                      );
                      updateCues(updated);
                      if (project) {
                        api.updateCaptions(project.id, updated).catch(() => {});
                      }
                    }}
                    className={`px-2 py-1 rounded text-[10px] font-mono border transition-all ${
                      (selectedCue.speaker || 'Speaker 1') === spk
                        ? 'bg-[#E3B5BE]/25 text-[#F7D7D1] border-[#E3B5BE]'
                        : 'bg-[#222326] text-[#FFF5F5]/60 border-[#393B3F] hover:text-[#FFF5F5]'
                    }`}
                  >
                    {spk}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Subtitle Textarea */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono text-[#FFF5F5]/60">
              <label>Caption Text</label>
              <span>{selectedCue.text?.length || 0} characters</span>
            </div>
            <textarea
              rows={3}
              value={selectedCue.text || ''}
              onChange={(e) => handleUpdateCueText(selectedCueIndex, e.target.value)}
              className="w-full bg-[#222326] text-[#FFF5F5] text-xs font-medium rounded-lg p-2.5 border border-[#393B3F] focus:border-[#E3B5BE] focus:outline-none leading-relaxed"
              placeholder="Enter spoken dialogue..."
            />
          </div>

          {/* Start and End Timestamps */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-[#222326] p-2 rounded-lg border border-[#393B3F] space-y-1">
              <span className="text-[10px] text-[#FFF5F5]/60 font-mono block">Start Time</span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[#F7D7D1]">
                  {(selectedCue.startMs / 1000).toFixed(2)}s
                </span>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateCueTiming(
                        selectedCueIndex,
                        Math.max(0, selectedCue.startMs / 1000 - 0.1),
                        selectedCue.endMs / 1000
                      )
                    }
                    className="p-1 rounded bg-[#18191B] hover:bg-[#34373B] text-[#FFF5F5]/70"
                    title="-0.1s"
                  >
                    <Minus className="w-2.5 h-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateCueTiming(
                        selectedCueIndex,
                        selectedCue.startMs / 1000 + 0.1,
                        selectedCue.endMs / 1000
                      )
                    }
                    className="p-1 rounded bg-[#18191B] hover:bg-[#34373B] text-[#FFF5F5]/70"
                    title="+0.1s"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-[#222326] p-2 rounded-lg border border-[#393B3F] space-y-1">
              <span className="text-[10px] text-[#FFF5F5]/60 font-mono block">End Time</span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[#F7D7D1]">
                  {(selectedCue.endMs / 1000).toFixed(2)}s
                </span>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateCueTiming(
                        selectedCueIndex,
                        selectedCue.startMs / 1000,
                        Math.max(selectedCue.startMs / 1000 + 0.1, selectedCue.endMs / 1000 - 0.1)
                      )
                    }
                    className="p-1 rounded bg-[#18191B] hover:bg-[#34373B] text-[#FFF5F5]/70"
                    title="-0.1s"
                  >
                    <Minus className="w-2.5 h-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateCueTiming(
                        selectedCueIndex,
                        selectedCue.startMs / 1000,
                        selectedCue.endMs / 1000 + 0.1
                      )
                    }
                    className="p-1 rounded bg-[#18191B] hover:bg-[#34373B] text-[#FFF5F5]/70"
                    title="+0.1s"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-6 text-center text-[#FFF5F5]/50 border border-dashed border-[#393B3F] rounded-xl bg-[#18191B]">
          <p className="font-medium text-[#FFF5F5]">No Layer Selected</p>
          <p className="text-[11px] mt-1 text-[#FFF5F5]/40">
            Click any clip on the timeline or select a layer chip above to inspect its parameters.
          </p>
        </div>
      )}
    </div>
  );
};
