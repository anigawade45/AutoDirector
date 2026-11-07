import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Grid,
} from 'lucide-react';
import { useEditorStore, selectEffectivePlan } from '../../stores/editorStore';

export const VideoPlayer: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    playback,
    setCurrentTime,
    setPlaybackStatus,
    setPlaybackRate,
    setVolume,
    toggleMute,
    stepFrame,
    preview,
    project,
  } = useEditorStore();

  const effectivePlan = useEditorStore(selectEffectivePlan);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSafeGuides, setShowSafeGuides] = useState(false);
  const [showRateMenu, setShowRateMenu] = useState(false);

  const fps = project?.fps || effectivePlan?.global?.fps || 30;

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
      setPlaybackStatus('playing');
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      setPlaybackStatus('paused');
    }
  }, [setPlaybackStatus]);

  // Synchronize playback rate
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playback.rate || 1.0;
    }
  }, [playback.rate]);

  // Synchronize volume and mute state
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = playback.volume;
      videoRef.current.muted = playback.muted;
    }
  }, [playback.volume, playback.muted]);

  // Synchronize external seeks (from timeline ruler or transcript click)
  useEffect(() => {
    if (videoRef.current) {
      const delta = Math.abs(videoRef.current.currentTime - playback.currentTime);
      if (delta > 0.08) {
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

  // rAF loop: sampling currentTime at ~30Hz master clock
  useEffect(() => {
    let animId: number;
    let lastTime = 0;

    const tick = () => {
      if (videoRef.current && !videoRef.current.paused) {
        const cur = videoRef.current.currentTime;
        if (Math.abs(cur - lastTime) > 0.033) {
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
    if (colorLayer?.params?.vignette) {
      const v = colorLayer.params.vignette;
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
    if (subtitleLayer) {
      const p = subtitleLayer.params;
      const cues = project?.analysisSummary?.cues;
      const activeCue = cues?.find((c) => curMs >= c.startMs && curMs <= c.endMs);

      const fontSize = p.size || 48;
      const fontFamily = p.font || 'Montserrat';
      const pos = p.position || 'bottom';
      const primaryColor = p.primaryColor || '#FFFFFF';
      const highlightColor = p.highlightColor || '#FFD84D';
      const maxWordsPerLine = p.maxWordsPerLine || 5;

      let yPos = canvas.height * 0.86;
      if (pos === 'top') yPos = canvas.height * 0.14;
      if (pos === 'center') yPos = canvas.height * 0.5;

      ctx.save();
      ctx.font = `800 ${fontSize}px ${fontFamily}, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(4, Math.round(fontSize * 0.12));
      ctx.strokeStyle = 'rgba(0,0,0,0.95)';
      ctx.lineJoin = 'round';

      if (activeCue) {
        if (activeCue.words && activeCue.words.length > 0) {
          // Break words into lines based on maxWordsPerLine
          const allWords = activeCue.words;
          const lines: (typeof allWords)[] = [];
          for (let i = 0; i < allWords.length; i += maxWordsPerLine) {
            lines.push(allWords.slice(i, i + maxWordsPerLine));
          }

          const lineHeight = fontSize * 1.25;
          const startY = yPos - ((lines.length - 1) * lineHeight) / 2;

          lines.forEach((lineWords, lineIdx) => {
            const currentLineY = startY + lineIdx * lineHeight;
            const wordWidths = lineWords.map((w) => ctx.measureText(w.word + ' ').width);
            const totalLineWidth = wordWidths.reduce((a, b) => a + b, 0);
            let currentX = canvas.width / 2 - totalLineWidth / 2;

            lineWords.forEach((wordObj, i) => {
              const isWordActive = curMs >= wordObj.startMs && curMs <= wordObj.endMs;
              const wordText = wordObj.word + ' ';
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
  }, [playback.currentTime, effectivePlan, project, showSafeGuides]);

  // Compute CSS filter for live video color grade approximation from ColorLayer
  const colorLayer = effectivePlan?.layers.find((l) => l.enabled && l.layer === 'color') as any;
  const contrast = colorLayer?.params?.contrast ?? 1.0;
  const saturation = colorLayer?.params?.saturation ?? 1.0;
  const brightness = 1.0 + (colorLayer?.params?.brightness ?? 0.0);
  const filterStyle = `contrast(${contrast}) saturate(${saturation}) brightness(${brightness})`;

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
      className="flex-1 flex flex-col bg-black relative overflow-hidden select-none"
    >
      {/* Video Canvas Container */}
      <div className="flex-1 relative flex items-center justify-center p-4">
        <div className="relative aspect-video max-h-full max-w-full bg-[#05080E] rounded-xl overflow-hidden shadow-2xl border border-surfaceBorder">
          {/* Master Video Element */}
          <video
            ref={videoRef}
            src={
              preview.url ||
              'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
            }
            playsInline
            muted={playback.muted}
            style={{
              filter: preview.mode === 'live' || preview.stale ? filterStyle : 'none',
            }}
            className="w-full h-full object-contain"
            onEnded={() => {
              setIsPlaying(false);
              setPlaybackStatus('ended');
            }}
          />

          {/* Real-time Canvas 2D Overlay (Subtitles, Overlays, Vignette, Intros) */}
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          />

          {/* Preview Mode & Stale State Indicator */}
          <div className="absolute top-3 left-3 flex items-center space-x-2 px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-md border border-white/10 text-[11px] text-slate-300">
            <span
              className={`w-2 h-2 rounded-full ${
                preview.stale ? 'bg-amber-400' : 'bg-emerald-400'
              } animate-pulse`}
            />
            <span className="font-medium">
              {preview.mode === 'proxy' && !preview.stale
                ? 'Rendered 480p Preview'
                : preview.stale
                  ? 'Live Approximation (Plan modified)'
                  : 'Live Realtime Preview'}
            </span>
          </div>

          {/* Safe Margins Toggle Indicator */}
          <div className="absolute top-3 right-3 flex items-center space-x-2">
            <button
              onClick={() => setShowSafeGuides(!showSafeGuides)}
              className={`p-1.5 rounded-md backdrop-blur-sm border transition-colors ${
                showSafeGuides
                  ? 'bg-blue-600/40 border-blue-400 text-blue-200'
                  : 'bg-black/60 border-white/10 text-slate-400 hover:text-white'
              }`}
              title="Toggle Safe Margins (90% Title, 80% Action)"
            >
              <Grid className="w-3.5 h-3.5" />
            </button>

            {effectivePlan && (
              <div className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-white/10 text-[10px] font-mono text-slate-400">
                EditPlan v{effectivePlan.version}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transport Control Bar */}
      <div className="h-12 bg-surface/90 border-t border-surfaceBorder px-4 flex items-center justify-between">
        {/* Playback Transport Buttons */}
        <div className="flex items-center space-x-2">
          {/* Rewind */}
          <button
            onClick={() => {
              if (videoRef.current) videoRef.current.currentTime = 0;
              setCurrentTime(0);
            }}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Rewind to start (Home)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Step Back 1 Frame */}
          <button
            onClick={() => stepFrame(-1)}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Step Back 1 Frame (Left Arrow)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Play / Pause Master */}
          <button
            onClick={togglePlay}
            className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow transition-transform active:scale-95"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          {/* Step Forward 1 Frame */}
          <button
            onClick={() => stepFrame(1)}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Step Forward 1 Frame (Right Arrow)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Timecode Readout */}
          <div className="text-xs font-mono text-slate-300 ml-2">
            <span>{formatTime(playback.currentTime)}</span>
            <span className="text-slate-500"> / </span>
            <span className="text-slate-500">{formatTime(playback.duration)}</span>
            <span className="text-slate-600 ml-2 text-[10px]">({fps}fps)</span>
          </div>
        </div>

        {/* Right audio, speed & display controls */}
        <div className="flex items-center space-x-3">
          {/* Playback Speed Rate Menu */}
          <div className="relative">
            <button
              onClick={() => setShowRateMenu(!showRateMenu)}
              className="flex items-center space-x-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-mono border border-surfaceBorder transition-colors"
              title="Playback Rate (J/L keys)"
            >
              <Gauge className="w-3.5 h-3.5 text-blue-400" />
              <span>{playback.rate || 1.0}x</span>
            </button>

            {showRateMenu && (
              <div className="absolute bottom-full mb-1.5 right-0 bg-[#0F141E] border border-surfaceBorder rounded-lg shadow-xl p-1 space-y-0.5 z-50">
                {playbackRates.map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setPlaybackRate(r);
                      setShowRateMenu(false);
                    }}
                    className={`w-full px-2.5 py-1 text-left text-xs font-mono rounded transition-colors ${
                      (playback.rate || 1.0) === r
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Volume Slider & Mute Toggle */}
          <div className="flex items-center space-x-1.5 bg-slate-900/60 px-2 py-1 rounded-lg border border-surfaceBorder">
            <button
              onClick={toggleMute}
              className="text-slate-400 hover:text-white transition-colors"
              title={playback.muted ? 'Unmute (M)' : 'Mute (M)'}
            >
              {playback.muted || playback.volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-amber-400" />
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
              className="w-16 h-1 accent-blue-500 bg-slate-800 rounded cursor-pointer"
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
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Fullscreen (F)"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </main>
  );
};
