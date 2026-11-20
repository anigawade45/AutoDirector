import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Maximize,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Grid,
  Type,
  Check,
  Pencil,
} from 'lucide-react';
import { useEditorStore, selectEffectivePlan } from '../../stores/editorStore';
import { computeColorCssFilter, resolveColorParams } from '@ai-video/shared';
import { computeNaturalWordTimings } from '../../utils/subtitleTiming';
import { api } from '../../api/client';
import { toast } from '../../stores/toastStore';

export const VideoPlayer: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    playback,
    setCurrentTime,
    setDuration,
    setPlaybackStatus,
    setPlaybackRate,
    setVolume,
    toggleMute,
    stepFrame,
    preview,
    project,
    registerVideoElement,
    togglePlayback,
    updateCues,
    selectLayer,
  } = useEditorStore();

  const effectivePlan = useEditorStore(selectEffectivePlan);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSafeGuides, setShowSafeGuides] = useState(false);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const [objectFitMode, setObjectFitMode] = useState<'contain' | 'cover'>('contain');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditingCanvasSubtitle, setIsEditingCanvasSubtitle] = useState(false);
  const [canvasSubtitleText, setCanvasSubtitleText] = useState('');
  const [editingCueIndex, setEditingCueIndex] = useState<number | null>(null);
  const canvasInputRef = useRef<HTMLTextAreaElement>(null);
  const [videoDims, setVideoDims] = useState<{ width: number; height: number }>({
    width: project?.media?.width || 1280,
    height: project?.media?.height || 720,
  });

  useEffect(() => {
    if (project?.media?.width && project?.media?.height) {
      setVideoDims({ width: project.media.width, height: project.media.height });
    }
  }, [project?.media?.width, project?.media?.height]);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const fps = project?.fps || effectivePlan?.global?.fps || 30;

  // Register video element in editor store for decoupled external controls (Timeline, Director, etc.)
  useEffect(() => {
    registerVideoElement(videoRef.current);
    return () => {
      registerVideoElement(null);
    };
  }, [registerVideoElement]);

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    togglePlayback();
  }, [togglePlayback]);

  // Check if current preview is pre-baked by server preview worker with burned-in effects
  const isVideoBaked =
    preview.mode === 'proxy' &&
    !preview.stale &&
    Boolean(preview.isRendered) &&
    preview.planVersion === effectivePlan?.version;

  // When the video is fully baked for the current plan version, play the baked preview.url.
  // In Live Approximation mode (plan modified / draft), play the clean baseProxyUrl so that live overlays
  // (subtitles, canvas titles, CSS color grades) don't double up over pre-rendered effects.
  const effectiveVideoSrc = isVideoBaked
    ? preview.url || preview.baseProxyUrl
    : preview.baseProxyUrl || preview.url;

  const isVideoSourcePreRendered = Boolean(preview.isRendered) && effectiveVideoSrc === preview.url;

  // Active Speed Layer calculation (Live video speed scaling when not baked into render)
  const speedLayer = effectivePlan?.layers.find((l) => l.enabled && l.layer === 'speed') as any;

  const currentSpeedFactor = (() => {
    if (!speedLayer || isVideoBaked) return 1.0;
    const curSec = playback.currentTime;
    if (speedLayer.range) {
      if (curSec >= speedLayer.range.start && curSec <= speedLayer.range.end) {
        return speedLayer.params?.factor ?? 1.0;
      }
      return 1.0;
    }
    return speedLayer.params?.factor ?? 1.0;
  })();

  const effectivePlaybackRate = Math.max(
    0.25,
    Math.min(4.0, (playback.rate || 1.0) * currentSpeedFactor)
  );

  // Synchronize playback rate and audio pitch preservation
  useEffect(() => {
    if (videoRef.current) {
      if (Math.abs(videoRef.current.playbackRate - effectivePlaybackRate) > 0.02) {
        videoRef.current.playbackRate = effectivePlaybackRate;
      }
      const keepPitch = speedLayer?.params?.keepPitch !== false;
      if ('preservesPitch' in videoRef.current) {
        videoRef.current.preservesPitch = keepPitch;
      } else if ('mozPreservesPitch' in videoRef.current) {
        (videoRef.current as any).mozPreservesPitch = keepPitch;
      } else if ('webkitPreservesPitch' in videoRef.current) {
        (videoRef.current as any).webkitPreservesPitch = keepPitch;
      }
    }
  }, [effectivePlaybackRate, speedLayer?.params?.keepPitch]);

  // Synchronize volume and mute state
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = playback.volume;
      videoRef.current.muted = playback.muted;
    }
  }, [playback.volume, playback.muted]);

  // Active cue and subtitle overlay calculation
  const curMs = playback.currentTime * 1000;
  const subtitleLayer = effectivePlan?.layers.find(
    (l) => l.enabled && l.layer === 'subtitle'
  ) as any;
  const cues = project?.analysisSummary?.cues;
  const activeCueIdx = cues
    ? cues.findIndex((c, idx) => {
        const nextStart = cues[idx + 1]?.startMs;
        const boundedEnd =
          nextStart !== undefined ? Math.min(c.endMs + 300, nextStart) : c.endMs + 300;
        return curMs >= c.startMs && curMs < boundedEnd;
      })
    : -1;
  const activeCue = activeCueIdx !== -1 && cues ? cues[activeCueIdx] : null;

  const handleStartCanvasSubtitleEdit = useCallback(() => {
    if (!activeCue || activeCueIdx === -1) return;
    if (isPlaying && videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
      setPlaybackStatus('paused');
    }
    setEditingCueIndex(activeCueIdx);
    setCanvasSubtitleText(activeCue.text || '');
    setIsEditingCanvasSubtitle(true);
    if (subtitleLayer) {
      selectLayer(subtitleLayer.id);
    }
    setTimeout(() => {
      canvasInputRef.current?.focus();
      canvasInputRef.current?.select();
    }, 50);
  }, [activeCue, activeCueIdx, isPlaying, setPlaybackStatus, subtitleLayer, selectLayer]);

  const handleSaveCanvasSubtitle = useCallback(async () => {
    if (!project || editingCueIndex === null) return;
    const currentCues = project.analysisSummary?.cues || [];
    const cueToUpdate = currentCues[editingCueIndex];
    if (!cueToUpdate) {
      setIsEditingCanvasSubtitle(false);
      return;
    }

    const trimmedText = canvasSubtitleText.trim();
    const tokens = trimmedText.split(/\s+/).filter(Boolean);
    const newWords = computeNaturalWordTimings(
      tokens,
      cueToUpdate.startMs,
      cueToUpdate.endMs,
      cueToUpdate.words as any
    );

    const updatedCues = currentCues.map((c, i) =>
      i === editingCueIndex
        ? {
            ...c,
            text: trimmedText,
            words: newWords as any,
          }
        : c
    );

    updateCues(updatedCues);
    setIsEditingCanvasSubtitle(false);
    toast.success(
      `Updated subtitle: "${trimmedText.length > 28 ? trimmedText.slice(0, 28) + '...' : trimmedText}"`,
      'Canvas Subtitle'
    );

    try {
      await api.updateCaptions(project.id, updatedCues);
    } catch (err: any) {
      console.error('Failed to sync canvas subtitle edit:', err);
      toast.error('Failed to save to server: ' + (err.message || 'Network error'), 'Captions Sync');
    }
  }, [project, editingCueIndex, canvasSubtitleText, updateCues]);

  // Synchronize external seeks (from timeline ruler or transcript click)
  useEffect(() => {
    if (videoRef.current) {
      const isPaused = videoRef.current.paused;
      const delta = Math.abs(videoRef.current.currentTime - playback.currentTime);
      // When playing, the native video element is the hardware master clock.
      // Only seek if there is an explicit large jump from user interaction (e.g. clicking the timeline ruler or jump shortcut).
      // When paused, maintain sub-frame accuracy for scrubbing and stepping.
      const threshold = isPaused ? 0.02 : 0.5;
      if (delta > threshold) {
        videoRef.current.currentTime = playback.currentTime;
      }
    }
  }, [playback.currentTime]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contentEditable
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) {
            setCurrentTime(Math.max(0, playback.currentTime - 1.0));
          } else {
            stepFrame(-1);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) {
            setCurrentTime(Math.min(playback.duration, playback.currentTime + 1.0));
          } else {
            stepFrame(1);
          }
          break;
        case 'KeyJ': // Shuttle reverse
          e.preventDefault();
          setPlaybackRate(Math.max(0.5, (playback.rate || 1) - 0.5));
          break;
        case 'KeyK': // Pause
          e.preventDefault();
          if (videoRef.current && !videoRef.current.paused) {
            videoRef.current.pause();
            setIsPlaying(false);
            setPlaybackStatus('paused');
          }
          break;
        case 'KeyL': // Shuttle forward
          e.preventDefault();
          setPlaybackRate(Math.min(2.0, (playback.rate || 1) + 0.5));
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
        case 'KeyF':
          e.preventDefault();
          if (containerRef.current) {
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else {
              containerRef.current.requestFullscreen();
            }
          }
          break;
        case 'Home':
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime = 0;
          setCurrentTime(0);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    togglePlay,
    stepFrame,
    setCurrentTime,
    playback.currentTime,
    playback.duration,
    playback.rate,
    setPlaybackRate,
    setPlaybackStatus,
    toggleMute,
  ]);

  // rAF loop: sampling currentTime during playback with smooth 20Hz UI throttling
  useEffect(() => {
    let animId: number;
    let lastTime = 0;

    const tick = () => {
      if (videoRef.current && !videoRef.current.paused) {
        const cur = videoRef.current.currentTime;
        if (Math.abs(cur - lastTime) >= 0.05) {
          lastTime = cur;
          setCurrentTime(cur);
        }
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [setCurrentTime]);

  // Canvas 2D Overlay Rendering — Derived strictly from plan.layers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render Safe Area Guides (Action Safe 80%, Title Safe 90%)
    if (showSafeGuides) {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);

      // Title Safe (90%)
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.strokeRect(
        canvas.width * 0.05,
        canvas.height * 0.05,
        canvas.width * 0.9,
        canvas.height * 0.9
      );

      // Action Safe (80%)
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.35)';
      ctx.strokeRect(
        canvas.width * 0.1,
        canvas.height * 0.1,
        canvas.width * 0.8,
        canvas.height * 0.8
      );

      // Center crosshair
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 - 15, canvas.height / 2);
      ctx.lineTo(canvas.width / 2 + 15, canvas.height / 2);
      ctx.moveTo(canvas.width / 2, canvas.height / 2 - 15);
      ctx.lineTo(canvas.width / 2, canvas.height / 2 + 15);
      ctx.stroke();

      // If target plan aspect differs from video (e.g. 9:16 target for 16:9 video), draw social framing crop guides
      const targetAspect = effectivePlan?.global?.aspect || project?.aspect;
      if (targetAspect === '9:16' && canvas.width > canvas.height) {
        const targetW = canvas.height * (9 / 16);
        const startX = (canvas.width - targetW) / 2;

        // Subtle shaded side zones
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, startX, canvas.height);
        ctx.fillRect(startX + targetW, 0, startX, canvas.height);

        // Reel guide outline
        ctx.strokeStyle = 'rgba(227, 181, 190, 0.85)';
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(startX, 0, targetW, canvas.height);

        ctx.font = '600 16px Inter, sans-serif';
        ctx.fillStyle = 'rgba(227, 181, 190, 0.95)';
        ctx.fillText('9:16 Reel Safe Zone', startX + 16, 36);
      }

      ctx.restore();
    }

    if (!effectivePlan) return;

    const curSec = playback.currentTime;
    const curMs = curSec * 1000;
    const totalSec = playback.duration || 60;

    // 1. Derive Intro Overlay (if intro layer enabled & within intro duration)
    const introLayer = effectivePlan.layers.find((l) => l.enabled && l.layer === 'intro') as any;
    if (introLayer && curSec <= (introLayer.params?.duration || 3)) {
      ctx.save();
      const introProgress = curSec / (introLayer.params?.duration || 3);
      const alpha = introProgress > 0.85 ? (1 - introProgress) / 0.15 : 1;
      ctx.fillStyle = `rgba(15, 23, 42, ${0.92 * alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 64px Montserrat, sans-serif';
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillText(introLayer.params?.text || 'INTRO', canvas.width / 2, canvas.height * 0.45);

      if (introLayer.params?.subtext) {
        ctx.font = '500 28px Inter, sans-serif';
        ctx.fillStyle = `rgba(148, 163, 184, ${alpha})`;
        ctx.fillText(introLayer.params.subtext, canvas.width / 2, canvas.height * 0.56);
      }
      ctx.restore();
      return;
    }

    // 2. Derive Outro Overlay (if outro layer enabled & within outro duration)
    const outroLayer = effectivePlan.layers.find((l) => l.enabled && l.layer === 'outro') as any;
    const outroDur = outroLayer?.params?.duration || 3;
    if (outroLayer && curSec >= Math.max(0, totalSec - outroDur)) {
      ctx.save();
      const outroProgress = (curSec - (totalSec - outroDur)) / outroDur;
      const alpha = Math.min(1, outroProgress * 2);
      ctx.fillStyle = `rgba(15, 23, 42, ${0.92 * alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 60px Montserrat, sans-serif';
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillText(
        outroLayer.params?.text || 'THANKS FOR WATCHING',
        canvas.width / 2,
        canvas.height * 0.45
      );

      if (outroLayer.params?.subtext) {
        ctx.font = '500 26px Inter, sans-serif';
        ctx.fillStyle = `rgba(148, 163, 184, ${alpha})`;
        ctx.fillText(outroLayer.params.subtext, canvas.width / 2, canvas.height * 0.55);
      }
      ctx.restore();
      return;
    }

    // 3. Derive Vignette from Color Layer
    const colorLayer = effectivePlan.layers.find((l) => l.enabled && l.layer === 'color') as any;
    if (colorLayer && !isVideoBaked && !isVideoSourcePreRendered) {
      const resolved = resolveColorParams(colorLayer.params);
      if (resolved.vignette > 0) {
        const v = resolved.vignette;
        const gradient = ctx.createRadialGradient(
          canvas.width / 2,
          canvas.height / 2,
          canvas.width * 0.28,
          canvas.width / 2,
          canvas.height / 2,
          canvas.width * 0.72
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, v * 0.75)})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    // 4. Derive Graphic Text Overlays from Text Layers
    const textLayers = effectivePlan.layers.filter((l) => l.enabled && l.layer === 'text') as any[];
    for (const tl of textLayers) {
      const inRange = !tl.range || (curSec >= tl.range.start && curSec <= tl.range.end);
      if (!inRange) continue;

      ctx.save();
      const posX = (tl.params?.position?.x ?? 0.5) * canvas.width;
      const posY = (tl.params?.position?.y ?? 0.5) * canvas.height;
      const font = tl.params?.font || 'Montserrat';
      const size = tl.params?.size || 42;
      const color = tl.params?.color || '#FFFFFF';

      // Animation calculation
      if (tl.params?.animation === 'scale') {
        const enterProgress = Math.min(1, (curSec - (tl.range?.start || 0)) / 0.3);
        const scale = 0.8 + 0.2 * enterProgress;
        ctx.translate(posX, posY);
        ctx.scale(scale, scale);
        ctx.translate(-posX, -posY);
      }

      ctx.font = `800 ${size}px ${font}, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Outline
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(tl.params?.content || '', posX, posY);

      // Fill
      ctx.fillStyle = color;
      ctx.fillText(tl.params?.content || '', posX, posY);
      ctx.restore();
    }

    // 5. Derive Subtitle Overlays from Subtitle Layer (Word-Pop & Multi-Line)
    const subtitleLayer = effectivePlan.layers.find(
      (l) => l.enabled && l.layer === 'subtitle'
    ) as any;
    if (subtitleLayer && !isVideoBaked && !isVideoSourcePreRendered) {
      const p = subtitleLayer.params;
      const cues = project?.analysisSummary?.cues;
      // Hold cue visible for brief read-time (up to +300ms) unless the next cue has already begun speaking
      const activeCue = cues?.find((c, idx) => {
        const nextStart = cues[idx + 1]?.startMs;
        const boundedEnd =
          nextStart !== undefined ? Math.min(c.endMs + 300, nextStart) : c.endMs + 300;
        return curMs >= c.startMs && curMs < boundedEnd;
      });

      const fontSize = p.size || 48;
      const fontFamily = p.font || 'Montserrat';
      const pos = p.position || 'bottom';
      const primaryColor = p.primaryColor || '#FFF5F5';
      const highlightColor = p.highlightColor || '#F7D7D1';
      const maxWordsPerLine = Math.max(3, p.maxWordsPerLine || 6);

      let yPos = canvas.height * 0.8;
      if (pos === 'top') yPos = canvas.height * 0.16;
      if (pos === 'center') yPos = canvas.height * 0.5;

      if (isEditingCanvasSubtitle) {
        return;
      }

      ctx.save();
      ctx.font = `800 ${fontSize}px ${fontFamily}, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(4, Math.round(fontSize * 0.12));
      ctx.strokeStyle = 'rgba(0,0,0,0.95)';
      ctx.lineJoin = 'round';

      if (activeCue) {
        const cueTokens = (activeCue.text || '').trim().split(/\s+/).filter(Boolean);
        // Use speech-aware natural word timings or existing aligned acoustic word timestamps
        const allWords =
          activeCue.words &&
          activeCue.words.length === cueTokens.length &&
          activeCue.words.length > 0
            ? activeCue.words
            : computeNaturalWordTimings(
                cueTokens,
                activeCue.startMs,
                activeCue.endMs,
                activeCue.words as any
              );

        if (allWords.length > 0) {
          // Break words into lines based on maxWordsPerLine
          const lines: (typeof allWords)[] = [];
          for (let i = 0; i < allWords.length; i += maxWordsPerLine) {
            lines.push(allWords.slice(i, i + maxWordsPerLine));
          }

          const lineHeight = fontSize * 1.25;
          let startY = yPos - ((lines.length - 1) * lineHeight) / 2;
          const maxBottomY = canvas.height * 0.88;
          if (startY + (lines.length - 1) * lineHeight > maxBottomY) {
            startY = maxBottomY - (lines.length - 1) * lineHeight;
          }

          lines.forEach((lineWords, lineIdx) => {
            const currentLineY = startY + lineIdx * lineHeight;
            const wordWidths = lineWords.map((w: any) => {
              const textVal = w.word || w.w || '';
              return ctx.measureText(textVal + ' ').width;
            });
            const totalLineWidth = wordWidths.reduce((a, b) => a + b, 0);
            let currentX = canvas.width / 2 - totalLineWidth / 2;

            lineWords.forEach((wordObj: any, i) => {
              const textVal = wordObj.word || wordObj.w || '';
              const startVal = wordObj.startMs !== undefined ? wordObj.startMs : wordObj.s || 0;
              const endVal =
                wordObj.endMs !== undefined ? wordObj.endMs : wordObj.e || startVal + 350;
              const isWordActive = curMs >= startVal && curMs <= endVal;
              const wordText = textVal + ' ';
              const wWidth = wordWidths[i];

              ctx.save();
              ctx.textAlign = 'left';

              if (isWordActive && p.style === 'word_pop') {
                ctx.translate(currentX + wWidth / 2, currentLineY);
                ctx.scale(1.15, 1.15);
                ctx.translate(-(currentX + wWidth / 2), -currentLineY);
              }

              ctx.strokeText(wordText, currentX, currentLineY);
              ctx.fillStyle = isWordActive ? highlightColor : primaryColor;
              ctx.fillText(wordText, currentX, currentLineY);
              ctx.restore();

              currentX += wWidth;
            });
          });
        } else {
          ctx.strokeText(activeCue.text, canvas.width / 2, yPos);
          ctx.fillStyle = highlightColor;
          ctx.fillText(activeCue.text, canvas.width / 2, yPos);
        }
      } else {
        // Fallback preview caption
        const sampleText = 'AutoDirector AI Preview';
        ctx.strokeText(sampleText, canvas.width / 2, yPos);
        ctx.fillStyle = highlightColor;
        ctx.fillText(sampleText, canvas.width / 2, yPos);
      }

      ctx.restore();
    }

    // 6. Derive Transition cue (if within transition duration window)
    const transitionLayers = effectivePlan.layers.filter(
      (l) => l.enabled && l.layer === 'transition'
    ) as any[];
    for (const tr of transitionLayers) {
      const at = tr.params?.at || 0;
      const dur = tr.params?.duration || 0.5;
      if (Math.abs(curSec - at) < dur / 2) {
        const transProgress = (curSec - (at - dur / 2)) / dur;
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${Math.sin(transProgress * Math.PI) * 0.45})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }
  }, [
    playback.currentTime,
    effectivePlan,
    project,
    showSafeGuides,
    isVideoBaked,
    isVideoSourcePreRendered,
  ]);

  // Compute CSS filter for live video color grade approximation from ColorLayer
  const colorLayer = effectivePlan?.layers.find((l) => l.enabled && l.layer === 'color') as any;
  const colorFilterResult = colorLayer ? computeColorCssFilter(colorLayer.params) : null;
  const filterStyle = colorFilterResult ? colorFilterResult.cssFilter : 'none';

  const activeFilter =
    colorLayer && !isVideoBaked && !isVideoSourcePreRendered ? filterStyle : 'none';

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${mins}:${s < 10 ? '0' : ''}${s}.${ms}`;
  };

  const playbackRates = [0.5, 1.0, 1.25, 1.5, 2.0];

  return (
    <main
      ref={containerRef}
      className="flex-1 min-h-0 flex flex-col bg-black relative overflow-hidden select-none"
    >
      {/* Video Canvas Container — Direct edge-to-edge video stage without artificial card borders */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center bg-black overflow-hidden group">
        {/* Master Video Element */}
        <video
          ref={videoRef}
          src={effectiveVideoSrc || undefined}
          playsInline
          muted={playback.muted}
          style={{
            filter: activeFilter,
            transition: 'filter 0.2s ease',
          }}
          className={`w-full h-full transition-all duration-200 ${
            objectFitMode === 'cover' ? 'object-cover' : 'object-contain'
          }`}
          onPlay={() => {
            setIsPlaying(true);
            setPlaybackStatus('playing');
          }}
          onPause={() => {
            setIsPlaying(false);
            setPlaybackStatus('paused');
          }}
          onEnded={() => {
            setIsPlaying(false);
            setPlaybackStatus('ended');
          }}
          onLoadedMetadata={(e) => {
            const dur = e.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setDuration(dur);
            }
            if (playback.currentTime > 0) {
              e.currentTarget.currentTime = playback.currentTime;
            }
            const vw = e.currentTarget.videoWidth;
            const vh = e.currentTarget.videoHeight;
            if (vw > 0 && vh > 0) {
              setVideoDims({ width: vw, height: vh });
            }
          }}
          onDurationChange={(e) => {
            const dur = e.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setDuration(dur);
            }
          }}
        />

        {/* Real-time CSS Vignette Overlay */}
        {colorLayer &&
          !isVideoBaked &&
          !isVideoSourcePreRendered &&
          (() => {
            const resolved = resolveColorParams(colorLayer.params);
            if (resolved.vignette <= 0) return null;
            return (
              <div
                className="absolute inset-0 pointer-events-none transition-all duration-200 z-[5]"
                style={{
                  background: `radial-gradient(circle at center, transparent 36%, rgba(0,0,0,${Math.min(0.92, resolved.vignette * 0.88).toFixed(2)}) 100%)`,
                }}
              />
            );
          })()}

        {/* Central Click-To-Play / Pause Overlay */}
        <div
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center cursor-pointer z-10"
          title={isPlaying ? 'Click to Pause' : 'Click to Play'}
        >
          {!isPlaying && (
            <div className="w-16 h-16 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-[#393B3F] flex items-center justify-center text-white shadow-2xl transition-all transform hover:scale-110 active:scale-95 group-hover:bg-[#E3B5BE]/80">
              <Play className="w-7 h-7 ml-1 fill-white text-white" />
            </div>
          )}
        </div>

        {/* Real-time Canvas 2D Overlay (Subtitles, Overlays, Vignette, Intros, Safe Guides) */}
        <canvas
          ref={canvasRef}
          width={videoDims.width}
          height={videoDims.height}
          className={`absolute inset-0 w-full h-full pointer-events-none transition-all duration-200 ${
            objectFitMode === 'cover' ? 'object-cover' : 'object-contain'
          }`}
        />

        {/* Interactive WYSIWYG Subtitle Overlay & Canvas In-Place Editor */}
        {subtitleLayer && activeCue && !isVideoBaked && !isVideoSourcePreRendered && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              top:
                subtitleLayer.params?.position === 'top'
                  ? '16%'
                  : subtitleLayer.params?.position === 'center'
                    ? '50%'
                    : '80%',
            }}
            className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[90%] sm:max-w-[80%] z-20 pointer-events-auto select-none"
          >
            {isEditingCanvasSubtitle ? (
              <div className="bg-[#18191B]/95 backdrop-blur-xl border-2 border-[#E3B5BE] rounded-xl p-3 shadow-2xl flex flex-col gap-2 min-w-[280px] sm:min-w-[420px] max-w-[620px] animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between text-[11px] font-mono text-[#F7D7D1]">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Type className="w-3.5 h-3.5 text-[#E3B5BE]" />
                    <span>Canvas Subtitle Editor</span>
                  </span>
                  <span className="text-[#FFF5F5]/60 text-[10px]">
                    {formatTime(activeCue.startMs / 1000)} - {formatTime(activeCue.endMs / 1000)}
                  </span>
                </div>
                <textarea
                  ref={canvasInputRef}
                  value={canvasSubtitleText}
                  onChange={(e) => setCanvasSubtitleText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSaveCanvasSubtitle();
                    } else if (e.key === 'Escape') {
                      setIsEditingCanvasSubtitle(false);
                    }
                  }}
                  className="w-full bg-[#121314] text-[#FFF5F5] text-sm sm:text-base font-semibold rounded-lg p-2.5 border border-[#393B3F] focus:border-[#E3B5BE] focus:outline-none resize-none shadow-inner"
                  rows={2}
                  autoFocus
                />
                <div className="flex items-center justify-between gap-2 text-xs pt-1">
                  <span className="text-[10px] text-[#FFF5F5]/40 font-mono hidden sm:inline">
                    <kbd className="px-1 py-0.5 bg-[#2A2C2F] rounded text-[#FFF5F5]/70">Enter</kbd> save • <kbd className="px-1 py-0.5 bg-[#2A2C2F] rounded text-[#FFF5F5]/70">Esc</kbd> cancel
                  </span>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setIsEditingCanvasSubtitle(false)}
                      className="px-2.5 py-1 rounded text-[11px] text-[#FFF5F5]/70 hover:bg-[#2A2C2F] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveCanvasSubtitle}
                      className="flex items-center space-x-1 px-3 py-1 rounded text-[11px] font-bold bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] shadow transition-all active:scale-95"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Apply</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                onClick={handleStartCanvasSubtitleEdit}
                className="group/sub relative cursor-pointer px-3 py-2 rounded-lg border border-transparent hover:border-[#E3B5BE]/60 hover:bg-black/40 hover:backdrop-blur-sm transition-all flex items-center justify-center text-center"
                title="Click to edit subtitle directly on canvas"
              >
                <div className="opacity-0 group-hover/sub:opacity-100 transition-opacity absolute -top-7 left-1/2 -translate-x-1/2 flex items-center space-x-1 bg-black/90 text-[#F7D7D1] border border-[#E3B5BE]/50 text-[10px] font-mono px-2 py-0.5 rounded shadow pointer-events-none whitespace-nowrap">
                  <Pencil className="w-2.5 h-2.5 text-[#E3B5BE]" />
                  <span>Click to edit caption text</span>
                </div>
                {/* Visual placeholder area matching canvas bounds */}
                <div className="h-8 min-w-[140px] pointer-events-none" />
              </div>
            )}
          </div>
        )}

        {/* Top Controls Overlay Header — Spans full width cleanly with zero badge collision */}
        <div className="absolute top-0 left-0 right-0 p-3 flex items-center justify-between pointer-events-none z-10 gap-2">
          {/* Preview Mode & Stale State Indicator */}
          <div className="pointer-events-auto flex items-center space-x-2 px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md border border-[#393B3F] text-[11px] text-[#FFF5F5]/80 min-w-0 shrink">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                preview.stale ? 'bg-amber-400' : 'bg-emerald-400'
              } animate-pulse`}
            />
            <span className="font-medium truncate">
              {preview.mode === 'proxy' && !preview.stale
                ? 'Rendered 480p Preview'
                : preview.stale
                  ? 'Live Approximation (Plan modified)'
                  : 'Live Realtime Preview'}
            </span>
          </div>

          {/* Safe Margins & Fit/Fill Toggle Controls */}
          <div className="pointer-events-auto flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            {/* Fit vs Fill Frame Toggle */}
            <button
              onClick={() => setObjectFitMode(objectFitMode === 'contain' ? 'cover' : 'contain')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md backdrop-blur-md border transition-colors shadow-sm ${
                objectFitMode === 'cover'
                  ? 'bg-[#E3B5BE]/25 border-[#E3B5BE] text-[#F7D7D1]'
                  : 'bg-black/70 border-white/10 text-[#FFF5F5]/70 hover:text-[#FFF5F5]'
              }`}
              title={
                objectFitMode === 'cover'
                  ? 'Fit in frame (Show full video with natural letterbox)'
                  : 'Fill screen (Occupy entire black screen edge-to-edge)'
              }
            >
              {objectFitMode === 'cover' ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-[11px] font-medium">Fit Frame</span>
                </>
              ) : (
                <>
                  <Maximize className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-[11px] font-medium">Fill Screen</span>
                </>
              )}
            </button>

            <button
              onClick={() => setShowSafeGuides(!showSafeGuides)}
              className={`p-1.5 rounded-md backdrop-blur-md border transition-colors ${
                showSafeGuides
                  ? 'bg-[#E3B5BE]/20 border-[#E3B5BE] text-[#F7D7D1]'
                  : 'bg-black/70 border-white/10 text-[#FFF5F5]/60 hover:text-[#FFF5F5]'
              }`}
              title="Toggle Safe Margins (90% Title, 80% Action)"
            >
              <Grid className="w-3.5 h-3.5" />
            </button>

            {effectivePlan && (
              <div className="px-2 py-1 rounded-md bg-black/70 backdrop-blur-md border border-[#393B3F] text-[10px] font-mono text-[#FFF5F5]/70">
                EditPlan v{effectivePlan.version}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transport Control Bar */}
      <div className="h-12 flex-shrink-0 bg-surface/90 border-t border-surfaceBorder px-2 sm:px-4 flex items-center justify-between z-20 gap-1">
        {/* Playback Transport Buttons */}
        <div className="flex items-center space-x-1 sm:space-x-2 min-w-0">
          {/* Rewind */}
          <button
            onClick={() => {
              if (videoRef.current) videoRef.current.currentTime = 0;
              setCurrentTime(0);
            }}
            className="p-1 sm:p-1.5 rounded hover:bg-[#2A2C2F] text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors shrink-0"
            title="Rewind to start (Home)"
          >
            <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          {/* Step Back 1 Frame */}
          <button
            onClick={() => stepFrame(-1)}
            className="hidden xs:flex p-1 sm:p-1.5 rounded hover:bg-[#2A2C2F] text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors shrink-0"
            title="Step Back 1 Frame (Left Arrow)"
          >
            <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          {/* Play / Pause Master */}
          <button
            onClick={togglePlay}
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] flex items-center justify-center shadow transition-transform active:scale-95 shrink-0"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-[#18191B]" />
            ) : (
              <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 ml-0.5 fill-[#18191B]" />
            )}
          </button>

          {/* Step Forward 1 Frame */}
          <button
            onClick={() => stepFrame(1)}
            className="hidden xs:flex p-1 sm:p-1.5 rounded hover:bg-[#2A2C2F] text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors shrink-0"
            title="Step Forward 1 Frame (Right Arrow)"
          >
            <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          {/* Timecode Readout */}
          <div className="text-[10px] sm:text-xs font-mono text-[#F7D7D1] ml-1 sm:ml-2 truncate">
            <span>{formatTime(playback.currentTime)}</span>
            <span className="text-[#393B3F]"> / </span>
            <span className="text-[#FFF5F5]/50">{formatTime(playback.duration)}</span>
            <span className="hidden md:inline text-[#FFF5F5]/40 ml-1.5 text-[10px]">
              ({fps}fps)
            </span>
          </div>
        </div>

        {/* Right audio, speed & display controls */}
        <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
          {/* Playback Speed Rate Menu */}
          <div className="relative">
            <button
              onClick={() => setShowRateMenu(!showRateMenu)}
              className="flex items-center space-x-1 px-1.5 sm:px-2 py-1 rounded bg-[#2A2C2F] hover:bg-[#34373B] text-[#FFF5F5] text-[10px] sm:text-xs font-mono border border-[#393B3F] transition-colors"
              title="Playback Rate (J/L keys)"
            >
              <Gauge className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#E3B5BE]" />
              <span>{effectivePlaybackRate}x</span>
            </button>

            {showRateMenu && (
              <div className="absolute bottom-full mb-1.5 right-0 bg-[#222326] border border-[#393B3F] rounded-lg shadow-xl p-1 space-y-0.5 z-50">
                {playbackRates.map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setPlaybackRate(r);
                      setShowRateMenu(false);
                    }}
                    className={`w-full px-2.5 py-1 text-left text-xs font-mono rounded transition-colors ${
                      (playback.rate || 1.0) === r
                        ? 'bg-[#E3B5BE] text-[#18191B] font-bold'
                        : 'text-[#FFF5F5]/70 hover:bg-[#2A2C2F]'
                    }`}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Volume Slider & Mute Toggle */}
          <div className="flex items-center space-x-1.5 bg-[#2A2C2F] px-1.5 sm:px-2 py-1 rounded-lg border border-[#393B3F]">
            <button
              onClick={toggleMute}
              className="text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors"
              title={playback.muted ? 'Unmute (M)' : 'Mute (M)'}
            >
              {playback.muted || playback.volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-[#E3B5BE]" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={playback.muted ? 0 : playback.volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="hidden sm:inline-block w-16 h-1 accent-[#E3B5BE] bg-[#18191B] rounded cursor-pointer"
              title={`Volume: ${Math.round(playback.volume * 100)}%`}
            />
          </div>

          {/* Fullscreen Button */}
          <button
            onClick={() => {
              if (containerRef.current) {
                if (document.fullscreenElement) {
                  document.exitFullscreen();
                } else {
                  containerRef.current.requestFullscreen();
                }
              }
            }}
            className="p-1 sm:p-1.5 rounded hover:bg-[#2A2C2F] text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors"
            title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            )}
          </button>
        </div>
      </div>
    </main>
  );
};
