import {
  EditPlan,
  CompactAnalysisSummary,
  RenderProfile,
  buildKeepSegments,
  buildFfmpegColorFilter,
  RESOLUTION_DIMENSIONS,
} from '@ai-video/shared';
import { AssGenerator } from './assGenerator.js';

export interface CompilerPaths {
  inputSourcePath?: string;
  musicSourcePath?: string;
  assSubtitlePath?: string;
  lutPath?: string;
  outputPath?: string;
  introSourcePath?: string;
  outroSourcePath?: string;
}

export interface CompilerResult {
  args: string[];
  assFiles: Array<{ filename: string; content: string }>;
  inputs: Array<{ key: string; type: 'video' | 'audio' | 'image' }>;
}

function mapTransitionType(type: string): string {
  switch (type) {
    case 'fade':
      return 'fade';
    case 'dissolve':
      return 'dissolve';
    case 'wipeleft':
      return 'wipeleft';
    case 'slideup':
      return 'slideup';
    case 'zoom':
      return 'zoomin';
    default:
      return 'dissolve';
  }
}

export class FFmpegCompiler {
  /**
   * Pure compiler interface: compile(plan, analysis, profile, paths?) -> { args, assFiles, inputs }
   * Strictly deterministic with 5 compiler passes according to Specification §4.4.
   */
  static compile(
    plan: EditPlan,
    analysis: CompactAnalysisSummary,
    profile: RenderProfile,
    paths?: CompilerPaths
  ): CompilerResult {
    const inputVideo = paths?.inputSourcePath || 'source.mp4';
    const outputVideo = paths?.outputPath || (profile === 'preview_480p' ? 'preview_480p.mp4' : 'out.mp4');

    const args: string[] = ['-y'];
    const inputs: Array<{ key: string; type: 'video' | 'audio' | 'image' }> = [
      { key: inputVideo, type: 'video' },
    ];
    const assFiles: Array<{ filename: string; content: string }> = [];

    // Add primary source video input (Index 0)
    args.push('-i', inputVideo);

    const filterComplexParts: string[] = [];
    const totalSec = Math.max(0.1, (analysis.durationMs || 60000) / 1000);

    const aspect = (plan.global?.aspect || '16:9') as keyof typeof RESOLUTION_DIMENSIONS;
    const resKey = profile === 'preview_480p' ? '480p' : profile === 'final_4k' ? '4k' : '1080p';
    const presetDims = RESOLUTION_DIMENSIONS[aspect]?.[resKey] || { width: 1920, height: 1080 };
    const targetWidth = plan.global?.width || presetDims.width;
    const targetHeight = plan.global?.height || presetDims.height;
    const targetFps = plan.global?.fps || 30;

    // =========================================================================
    // PASS 1: Segment Build (Apply cut layers to produce keep-segments in source time)
    // =========================================================================
    const cutLayers = plan.layers.filter((l) => l.enabled && l.layer === 'cut') as any[];
    const speedLayers = plan.layers.filter((l) => l.enabled && l.layer === 'speed') as any[];
    const transitionLayers = plan.layers.filter((l) => l.enabled && l.layer === 'transition') as any[];
    const introLayer = plan.layers.find((l) => l.enabled && l.layer === 'intro') as any;
    const outroLayer = plan.layers.find((l) => l.enabled && l.layer === 'outro') as any;

    const keepSegments = buildKeepSegments(cutLayers, totalSec, speedLayers, plan.global.fps || 30);

    // =========================================================================
    // PASS 2: Per-Segment Video & Audio Chain (Trim, Speed, Atempo, Normalization)
    // =========================================================================
    // 2A. Intro Template / Media Input (if present)
    if (introLayer) {
      const introDur = introLayer.params?.duration ?? 5;
      if (paths?.introSourcePath) {
        const introIdx = inputs.length;
        args.push('-i', paths.introSourcePath);
        inputs.push({ key: paths.introSourcePath, type: 'video' });
        filterComplexParts.push(
          `[${introIdx}:v]trim=0:${introDur},setpts=PTS-STARTPTS,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${targetFps},format=yuv420p[v_intro]`
        );
        filterComplexParts.push(
          `[${introIdx}:a]atrim=0:${introDur},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a_intro]`
        );
      } else {
        const bg = introLayer.params?.theme ? introLayer.params.theme.replace('#', '0x') : '0x0F172A';
        let vIntroFilter = `color=c=${bg}:s=${targetWidth}x${targetHeight}:r=${targetFps}:d=${introDur.toFixed(3)},format=yuv420p`;
        if (introLayer.params?.text) {
          const escapedText = introLayer.params.text.replace(/'/g, "\\'").replace(/:/g, '\\:');
          vIntroFilter += `,drawtext=text='${escapedText}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`;
        }
        filterComplexParts.push(`${vIntroFilter}[v_intro]`);
        filterComplexParts.push(
          `anullsrc=r=44100:cl=stereo,atrim=0:${introDur.toFixed(3)},asetpts=PTS-STARTPTS[a_intro]`
        );
      }
    }

    // 2B. Keep Segments Video & Audio Chains
    const vLabels: string[] = [];
    const aLabels: string[] = [];

    for (let i = 0; i < keepSegments.length; i++) {
      const seg = keepSegments[i];
      const vLabel = `v${i}`;
      const aLabel = `a${i}`;
      const segSpeed = seg.speed || 1.0;

      // Video chain: trim + setpts (+ optional dimension/fps normalization when mixed with intro/outro)
      let vChain = `[0:v]trim=${seg.srcStart}:${seg.srcEnd}`;
      if (segSpeed !== 1.0) {
        vChain += `,setpts=(PTS-STARTPTS)/${segSpeed.toFixed(3)}`;
      } else {
        vChain += `,setpts=PTS-STARTPTS`;
      }
      if (introLayer || outroLayer) {
        vChain += `,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${targetFps},format=yuv420p`;
      }
      filterComplexParts.push(`${vChain}[${vLabel}]`);

      // Audio chain: atrim + asetpts + chained atempo (+ sample rate normalization)
      let atempoClause = '';
      if (segSpeed !== 1.0) {
        if (segSpeed > 2.0) {
          atempoClause = `,atempo=2.0,atempo=${(segSpeed / 2.0).toFixed(3)}`;
        } else if (segSpeed < 0.5) {
          atempoClause = `,atempo=0.5,atempo=${(segSpeed / 0.5).toFixed(3)}`;
        } else {
          atempoClause = `,atempo=${segSpeed.toFixed(3)}`;
        }
      }

      let aChain = `[0:a]atrim=${seg.srcStart}:${seg.srcEnd},asetpts=PTS-STARTPTS${atempoClause}`;
      if (introLayer || outroLayer) {
        aChain += `,aformat=sample_rates=44100:channel_layouts=stereo`;
      }
      filterComplexParts.push(`${aChain}[${aLabel}]`);

      vLabels.push(`[${vLabel}]`);
      aLabels.push(`[${aLabel}]`);
    }

    // 2C. Outro Template / Media Input (if present)
    if (outroLayer) {
      const outroDur = outroLayer.params?.duration ?? 5;
      if (paths?.outroSourcePath) {
        const outroIdx = inputs.length;
        args.push('-i', paths.outroSourcePath);
        inputs.push({ key: paths.outroSourcePath, type: 'video' });
        filterComplexParts.push(
          `[${outroIdx}:v]trim=0:${outroDur},setpts=PTS-STARTPTS,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${targetFps},format=yuv420p[v_outro]`
        );
        filterComplexParts.push(
          `[${outroIdx}:a]atrim=0:${outroDur},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a_outro]`
        );
      } else {
        const bg = outroLayer.params?.theme ? outroLayer.params.theme.replace('#', '0x') : '0x0F172A';
        let vOutroFilter = `color=c=${bg}:s=${targetWidth}x${targetHeight}:r=${targetFps}:d=${outroDur.toFixed(3)},format=yuv420p`;
        if (outroLayer.params?.text) {
          const escapedText = outroLayer.params.text.replace(/'/g, "\\'").replace(/:/g, '\\:');
          vOutroFilter += `,drawtext=text='${escapedText}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`;
        }
        filterComplexParts.push(`${vOutroFilter}[v_outro]`);
        filterComplexParts.push(
          `anullsrc=r=44100:cl=stereo,atrim=0:${outroDur.toFixed(3)},asetpts=PTS-STARTPTS[a_outro]`
        );
      }
    }

    // =========================================================================
    // PASS 3: Join (Concat or Transitions with xfade & acrossfade)
    // =========================================================================
    interface SequenceUnit {
      vLabel: string;
      aLabel: string;
      duration: number;
      transitionAfter?: {
        type: string;
        duration: number;
      } | null;
    }

    const units: SequenceUnit[] = [];

    if (introLayer) {
      const introDur = introLayer.params?.duration ?? 5;
      const introTrans = transitionLayers.find(
        (t) => Math.abs(t.params.at - 0) < 0.2 || Math.abs(t.params.at - introDur) < 0.2
      );
      units.push({
        vLabel: '[v_intro]',
        aLabel: '[a_intro]',
        duration: introDur,
        transitionAfter: introTrans
          ? { type: introTrans.params.type, duration: introTrans.params.duration }
          : null,
      });
    }

    for (let i = 0; i < keepSegments.length; i++) {
      const seg = keepSegments[i];
      const segSpeed = seg.speed || 1.0;
      const segDur = (seg.srcEnd - seg.srcStart) / segSpeed;

      let transitionAfter: { type: string; duration: number } | null = null;
      if (i < keepSegments.length - 1) {
        const trans = transitionLayers.find((t) => Math.abs(t.params.at - seg.srcEnd) < 0.2);
        if (trans) {
          transitionAfter = {
            type: trans.params.type,
            duration: trans.params.duration,
          };
        }
      } else if (outroLayer) {
        const trans = transitionLayers.find((t) => Math.abs(t.params.at - seg.srcEnd) < 0.2);
        if (trans) {
          transitionAfter = {
            type: trans.params.type,
            duration: trans.params.duration,
          };
        }
      }

      units.push({
        vLabel: `[v${i}]`,
        aLabel: `[a${i}]`,
        duration: segDur,
        transitionAfter,
      });
    }

    if (outroLayer) {
      const outroDur = outroLayer.params?.duration ?? 5;
      units.push({
        vLabel: '[v_outro]',
        aLabel: '[a_outro]',
        duration: outroDur,
        transitionAfter: null,
      });
    }

    let currentVOut = '[vc]';
    let currentAOut = '[ac]';

    if (units.length === 0) {
      currentVOut = '[0:v]';
      currentAOut = '[0:a]';
    } else if (units.length === 1 && !units[0].transitionAfter) {
      currentVOut = units[0].vLabel;
      currentAOut = units[0].aLabel;
    } else {
      const hasTransitions = units.some((u) => u.transitionAfter != null);

      if (!hasTransitions) {
        const allV = units.map((u) => u.vLabel).join('');
        const allA = units.map((u) => u.aLabel).join('');
        filterComplexParts.push(`${allV}concat=n=${units.length}:v=1:a=0[vc]`);
        filterComplexParts.push(`${allA}concat=n=${units.length}:v=0:a=1[ac]`);
      } else {
        // Group contiguous units linked by transitions
        const groups: Array<{ units: SequenceUnit[] }> = [];
        let currentGroup: SequenceUnit[] = [];

        for (let u = 0; u < units.length; u++) {
          currentGroup.push(units[u]);
          if (!units[u].transitionAfter || u === units.length - 1) {
            groups.push({ units: currentGroup });
            currentGroup = [];
          }
        }
        if (currentGroup.length > 0) {
          groups.push({ units: currentGroup });
        }

        const groupVOutputs: string[] = [];
        const groupAOutputs: string[] = [];

        for (let g = 0; g < groups.length; g++) {
          const grp = groups[g];
          if (grp.units.length === 1) {
            groupVOutputs.push(grp.units[0].vLabel);
            groupAOutputs.push(grp.units[0].aLabel);
          } else {
            let gV = grp.units[0].vLabel;
            let gA = grp.units[0].aLabel;
            let gDur = grp.units[0].duration;

            for (let j = 0; j < grp.units.length - 1; j++) {
              const nextU = grp.units[j + 1];
              const tr = grp.units[j].transitionAfter!;
              const transDur = Math.min(tr.duration, gDur * 0.45, nextU.duration * 0.45);
              const offset = Number((gDur - transDur).toFixed(3));
              const xfadeType = mapTransitionType(tr.type);

              const outV = `[xv_${g}_${j}]`;
              const outA = `[xa_${g}_${j}]`;

              filterComplexParts.push(
                `${gV}${nextU.vLabel}xfade=transition=${xfadeType}:duration=${transDur.toFixed(3)}:offset=${offset.toFixed(3)}${outV}`
              );
              filterComplexParts.push(
                `${gA}${nextU.aLabel}acrossfade=d=${transDur.toFixed(3)}:c1=tri:c2=tri${outA}`
              );

              gV = outV;
              gA = outA;
              gDur = gDur + nextU.duration - transDur;
            }

            groupVOutputs.push(gV);
            groupAOutputs.push(gA);
          }
        }

        if (groupVOutputs.length === 1) {
          currentVOut = groupVOutputs[0];
          currentAOut = groupAOutputs[0];
        } else {
          filterComplexParts.push(
            `${groupVOutputs.join('')}concat=n=${groupVOutputs.length}:v=1:a=0[vc]`
          );
          filterComplexParts.push(
            `${groupAOutputs.join('')}concat=n=${groupAOutputs.length}:v=0:a=1[ac]`
          );
          currentVOut = '[vc]';
          currentAOut = '[ac]';
        }
      }
    }

    // =========================================================================
    // PASS 4: Overlays & Subtitles (Color, ASS Subtitles, Text)
    // =========================================================================
    // 4A. Color Grading
    const colorLayer = plan.layers.find((l) => l.enabled && l.layer === 'color') as any;
    if (colorLayer) {
      const colorFilter = buildFfmpegColorFilter(colorLayer.params, {
        lutPath: paths?.lutPath,
      });
      if (colorFilter) {
        filterComplexParts.push(`${currentVOut}${colorFilter}[vcolor]`);
        currentVOut = '[vcolor]';
      }
    }

    // 4B. Subtitles (ASS)
    const subtitleLayer = plan.layers.find((l) => l.enabled && l.layer === 'subtitle') as any;
    if (subtitleLayer) {
      const subParams = subtitleLayer.params || {};
      const baseFontSize = profile === 'preview_480p' ? 34 : profile === 'final_4k' ? 104 : 54;
      const fontSize = subParams.size
        ? Math.round((subParams.size / 54) * baseFontSize)
        : baseFontSize;

      const cues: any[] = (analysis.transcriptExcerpt || []).map((t: any, idx: number) => ({
        id: `cue_${idx + 1}`,
        startMs: t.startMs,
        endMs: t.endMs,
        text: t.text,
        words:
          t.words ||
          t.text.split(' ').map((w: string, wIdx: number, arr: string[]) => {
            const dur = (t.endMs - t.startMs) / Math.max(1, arr.length);
            return {
              w,
              s: Math.round(t.startMs + wIdx * dur),
              e: Math.round(t.startMs + (wIdx + 1) * dur),
              conf: 0.98,
            };
          }),
      }));

      const assContent = AssGenerator.generateAss(cues, {
        width: targetWidth,
        height: targetHeight,
        font: subParams.font || 'Montserrat',
        fontSize,
        style: subParams.style || 'word_pop',
        position: subParams.position || 'bottom',
        primaryColor: subParams.primaryColor || '#FFFFFF',
        highlightColor: subParams.highlightColor || '#FFD84D',
        maxWordsPerLine: subParams.maxWordsPerLine || 4,
      });

      assFiles.push({ filename: 'subtitles.ass', content: assContent });

      const subPath = paths?.assSubtitlePath || 'subtitles.ass';
      const escapedSubPath = subPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      filterComplexParts.push(`${currentVOut}subtitles='${escapedSubPath}'[vsubs]`);
      currentVOut = '[vsubs]';
    }

    // =========================================================================
    // PASS 5: Audio Chain (Music Ducking, EBU R128 Loudnorm, Denoise & Fades)
    // =========================================================================
    const audioLayer = plan.layers.find((l) => l.enabled && l.layer === 'audio') as any;
    const normalizeLufs = audioLayer?.params?.normalizeLufs ?? -16;
    const denoise = audioLayer?.params?.denoise ?? false;

    // Apply FFT audio denoise if enabled in AudioLayer (Spec §4.4)
    if (denoise) {
      filterComplexParts.push(`${currentAOut}afftdn=nf=-25[adenoise]`);
      currentAOut = '[adenoise]';
    }

    const musicLayer = plan.layers.find((l) => l.enabled && l.layer === 'music') as any;
    if (paths?.musicSourcePath || musicLayer) {
      const musicPath = paths?.musicSourcePath || 'music.mp3';
      const musicInputIndex = inputs.length;
      args.push('-i', musicPath);
      inputs.push({ key: musicPath, type: 'audio' });

      const vol = musicLayer?.params?.volume ?? 0.35;
      const duck = musicLayer?.params?.duckUnderSpeech ?? true;
      const fadeIn = musicLayer?.params?.fadeIn;
      const fadeOut = musicLayer?.params?.fadeOut;

      const musicFilters: string[] = [`volume=${vol}`];
      if (typeof fadeIn === 'number' && fadeIn > 0) {
        musicFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(2)}`);
      }
      if (typeof fadeOut === 'number' && fadeOut > 0 && totalSec > fadeOut) {
        const fadeOutStart = Math.max(0, totalSec - fadeOut);
        musicFilters.push(`afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeOut.toFixed(2)}`);
      }

      filterComplexParts.push(`[${musicInputIndex}:a]${musicFilters.join(',')}[m]`);
      if (duck) {
        filterComplexParts.push(
          `[m]${currentAOut}sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[md]`
        );
        filterComplexParts.push(
          `[md]${currentAOut}amix=inputs=2:normalize=0,loudnorm=I=${normalizeLufs}:TP=-1.5:LRA=11[aout]`
        );
      } else {
        filterComplexParts.push(
          `[m]${currentAOut}amix=inputs=2:normalize=0,loudnorm=I=${normalizeLufs}:TP=-1.5:LRA=11[aout]`
        );
      }
      currentAOut = '[aout]';
    } else {
      filterComplexParts.push(
        `${currentAOut}loudnorm=I=${normalizeLufs}:TP=-1.5:LRA=11[aout]`
      );
      currentAOut = '[aout]';
    }

    // Final Filter Complex Assembly
    if (filterComplexParts.length > 0) {
      args.push('-filter_complex', filterComplexParts.join('; '));
      args.push('-map', currentVOut);
      args.push('-map', currentAOut);
    }

    // Output Encoding Profile
    if (profile === 'preview_480p') {
      args.push(
        '-s', '854x480',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '28',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        outputVideo
      );
    } else if (profile === 'final_4k') {
      args.push(
        '-s', '3840x2160',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '18',
        '-c:a', 'aac',
        '-b:a', '384k',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        outputVideo
      );
    } else {
      // Default: final_1080p
      args.push(
        '-s', '1920x1080',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '18',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        outputVideo
      );
    }

    return { args, assFiles, inputs };
  }
}
