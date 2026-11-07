import { CaptionCue, WordTiming, SubtitleStyle, SubtitlePosition } from '@ai-video/shared';

export interface AssOptions {
  width?: number;
  height?: number;
  font?: string;
  fontSize?: number;
  style?: SubtitleStyle;
  position?: SubtitlePosition;
  primaryColor?: string; // hex '#FFFFFF'
  highlightColor?: string; // hex '#FFD84D'
  maxWordsPerLine?: number; // 2 to 8
}

export class AssGenerator {
  /**
   * Converts hex color '#RRGGBB' to ASS color format '&HAABBGGRR&'
   */
  static hexToAssColor(hex: string, alpha: string = '00'): string {
    const clean = hex.replace('#', '').trim();
    if (clean.length === 6) {
      const r = clean.substring(0, 2);
      const g = clean.substring(2, 4);
      const b = clean.substring(4, 6);
      return `&H${alpha}${b}${g}${r}&`;
    }
    if (clean.length === 3) {
      const r = clean[0] + clean[0];
      const g = clean[1] + clean[1];
      const b = clean[2] + clean[2];
      return `&H${alpha}${b}${g}${r}&`;
    }
    return `&H${alpha}FFFFFF&`;
  }

  /**
   * Formats milliseconds to ASS timestamp: H:MM:SS.CC (centiseconds)
   */
  static formatAssTime(ms: number): string {
    const totalSec = Math.max(0, ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = Math.floor(totalSec % 60);
    const centiseconds = Math.floor((totalSec % 1) * 100);

    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    const cc = String(centiseconds).padStart(2, '0');

    return `${hours}:${mm}:${ss}.${cc}`;
  }

  /**
   * Sanitizes and escapes text to prevent ASS tag injection (Spec §4.8).
   * Escapes \, {, and } characters.
   */
  static escapeAssText(text: string): string {
    if (!text) return '';
    return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  }

  /**
   * Generates a complete ASS subtitle script with support for:
   * - 4 distinct styles: classic, word_pop, karaoke, minimal (Spec §3.3)
   * - 3 positions: bottom, center, top (Spec §3.3)
   * - maxWordsPerLine chunking / pagination (Spec §3.3)
   * - Per-word animated pop scaling or karaoke fill tags (Spec §4.4)
   * - Strict ASS injection sanitization (Spec §4.8)
   */
  static generateAss(cues: CaptionCue[], options: AssOptions = {}): string {
    const width = options.width || 1920;
    const height = options.height || 1080;
    const font = options.font || 'Montserrat';
    const fontSize = Math.max(16, Math.min(140, options.fontSize || 54));
    const style: SubtitleStyle = options.style || 'word_pop';
    const position: SubtitlePosition = options.position || 'bottom';
    const maxWords = Math.max(2, Math.min(8, options.maxWordsPerLine || 4));

    const primaryAss = this.hexToAssColor(options.primaryColor || '#FFFFFF');
    const highlightAss = this.hexToAssColor(options.highlightColor || '#FFD84D');
    const outlineAss = '&H00000000&';
    const shadowAss = '&H80000000&';

    // Alignment & vertical margins
    let alignment = 2; // Bottom-center
    let marginV = Math.round(height * 0.08);

    if (position === 'top') {
      alignment = 8; // Top-center
      marginV = Math.round(height * 0.08);
    } else if (position === 'center') {
      alignment = 5; // Middle-center
      marginV = 0;
    }

    // Style-specific styling definitions
    let bold = 1;
    let borderStyle = 1; // 1 = outline + shadow
    let outline = 3.5;
    let shadow = 2.0;

    if (style === 'minimal') {
      bold = 0;
      borderStyle = 3; // 3 = opaque box / translucent box
      outline = 1.0;
      shadow = 0;
    } else if (style === 'classic') {
      bold = 1;
      outline = 3.0;
      shadow = 1.5;
    } else if (style === 'karaoke') {
      bold = 1;
      outline = 3.2;
      shadow = 2.0;
    }

    let ass = `[Script Info]
Title: AI Video Platform Subtitles
ScriptType: v4.00+
WrapStyle: 0
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},${fontSize},${primaryAss},${highlightAss},${outlineAss},${shadowAss},${bold},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},30,30,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    for (const cue of cues) {
      const words: WordTiming[] = cue.words && cue.words.length > 0 ? cue.words : [];

      if (words.length === 0) {
        // Fallback: cue without word timings
        const escaped = this.escapeAssText(cue.text);
        const start = this.formatAssTime(cue.startMs);
        const end = this.formatAssTime(cue.endMs);
        const effect = style === 'minimal' ? '{\\fad(80,80)}' : '{\\fad(50,50)}';
        ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${effect}${escaped}\n`;
        continue;
      }

      // Chunk words into lines of at most maxWordsPerLine
      const chunks: WordTiming[][] = [];
      for (let i = 0; i < words.length; i += maxWords) {
        chunks.push(words.slice(i, i + maxWords));
      }

      for (const chunk of chunks) {
        if (chunk.length === 0) continue;

        const chunkStartMs = chunk[0].s;
        const chunkEndMs = Math.max(chunk[0].s + 100, chunk[chunk.length - 1].e);

        if (style === 'word_pop') {
          // Word-Pop: each active word scales up and illuminates in highlightColor
          for (let i = 0; i < chunk.length; i++) {
            const activeWord = chunk[i];
            const nextWord = chunk[i + 1];
            const wordStartMs = activeWord.s;
            const wordEndMs = nextWord ? nextWord.s : activeWord.e;

            if (wordEndMs <= wordStartMs) continue;

            const wordStart = this.formatAssTime(wordStartMs);
            const wordEnd = this.formatAssTime(wordEndMs);

            const lineFormatted = chunk
              .map((w, idx) => {
                const escapedWord = this.escapeAssText(w.w);
                if (idx === i) {
                  // Active word popped up with highlight color (110% scale)
                  return `{\\c${highlightAss}\\fscx110\\fscy110}${escapedWord}{\\r}`;
                }
                // Inactive words in primary color at normal scale
                return `{\\c${primaryAss}\\fscx100\\fscy100}${escapedWord}{\\r}`;
              })
              .join(' ');

            ass += `Dialogue: 0,${wordStart},${wordEnd},Default,,0,0,0,,${lineFormatted}\n`;
          }
        } else if (style === 'karaoke') {
          // Karaoke: uses \kf tags to smoothly fill word by word (Spec §4.4)
          const start = this.formatAssTime(chunkStartMs);
          const end = this.formatAssTime(chunkEndMs);

          const karaokeParts = chunk.map((w) => {
            const durationCs = Math.max(5, Math.round((w.e - w.s) / 10));
            const escapedWord = this.escapeAssText(w.w);
            return `{\\kf${durationCs}}${escapedWord} `;
          });

          ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\fad(60,60)}${karaokeParts.join('').trim()}\n`;
        } else if (style === 'classic') {
          // Classic: clean legible line display with subtle fade
          const start = this.formatAssTime(chunkStartMs);
          const end = this.formatAssTime(chunkEndMs);
          const text = chunk.map((w) => this.escapeAssText(w.w)).join(' ');

          ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\fad(50,50)}${text}\n`;
        } else if (style === 'minimal') {
          // Minimal: modern borderless / translucent box style with smooth fade
          const start = this.formatAssTime(chunkStartMs);
          const end = this.formatAssTime(chunkEndMs);
          const text = chunk.map((w) => this.escapeAssText(w.w)).join(' ');

          ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\fad(100,100)}${text}\n`;
        }
      }
    }

    return ass;
  }
}
