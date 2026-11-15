import React from 'react';
import {
  Film,
  HardDrive,
  Activity,
  Scissors,
  Music,
  Volume2,
  FileText,
  Clock,
  Sparkles,
  Layers,
  ChevronRight,
  Loader2,
  PlayCircle,
  MicOff,
} from 'lucide-react';
import { useEditorStore, selectEffectivePlan } from '../../stores/editorStore';

export const ProjectPanel: React.FC = () => {
  const { project, playback, setCurrentTime, selectLayer } = useEditorStore();
  const effectivePlan = useEditorStore(selectEffectivePlan);

  const formatTime = (ms: number) => {
    const totalSec = ms / 1000;
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    const millis = Math.floor((totalSec % 1) * 10);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}.${millis}`;
  };

  const currentSec = playback.currentTime;
  const analysis = project?.analysisSummary;

  // Real speech cues from backend Whisper audio analysis
  const cues = analysis?.cues || [];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 select-none text-xs font-sans text-[#FFF5F5]">
      {/* Project & Media Info Card */}
      <div className="bg-[#18191B] rounded-xl p-3 border border-[#393B3F] space-y-2.5">
        <div className="flex items-center justify-between text-[#FFF5F5]">
          <div className="flex items-center space-x-1.5 font-semibold">
            <Film className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span className="truncate max-w-[150px]">{project?.title || 'Project'}</span>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-[#2A2C2F] text-[10px] text-[#F7D7D1] font-mono border border-[#393B3F]">
            {project?.status || 'ready'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-[#393B3F]">
          <div>
            <span className="text-[#FFF5F5]/50 block text-[10px]">Resolution</span>
            <span className="font-mono text-[#FFF5F5]">
              {project?.media ? `${project.media.width}x${project.media.height}` : '1920x1080'}
            </span>
          </div>
          <div>
            <span className="text-[#FFF5F5]/50 block text-[10px]">Frame Rate</span>
            <span className="font-mono text-[#FFF5F5]">{project?.fps || 30} FPS</span>
          </div>
          <div>
            <span className="text-[#FFF5F5]/50 block text-[10px]">Aspect Ratio</span>
            <span className="font-mono text-[#FFF5F5]">{project?.aspect || '16:9'}</span>
          </div>
          <div>
            <span className="text-[#FFF5F5]/50 block text-[10px]">Duration</span>
            <span className="font-mono text-[#F7D7D1]">
              {formatTime((project?.durationSec || 60) * 1000)}
            </span>
          </div>
        </div>

        {project?.assetId && (
          <div className="pt-2 border-t border-[#393B3F] flex items-center justify-between text-[10px] text-[#FFF5F5]/60 font-mono">
            <span className="flex items-center space-x-1">
              <HardDrive className="w-3 h-3 text-[#E3B5BE]" />
              <span>Base Asset</span>
            </span>
            <span className="text-[#FFF5F5]/80 truncate max-w-[120px]">
              {project.assetId}
            </span>
          </div>
        )}
      </div>

      {/* Media Analysis Summary */}
      <div>
        <div className="flex items-center space-x-2 text-[#FFF5F5] font-semibold mb-2.5">
          <Sparkles className="w-3.5 h-3.5 text-[#E3B5BE]" />
          <span>Media Intelligence & Audio</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[#18191B] p-2.5 rounded-xl border border-[#393B3F]">
            <span className="text-[#FFF5F5]/60 flex items-center space-x-1 text-[11px]">
              <Scissors className="w-3 h-3 text-[#E3B5BE]" />
              <span>Silences</span>
            </span>
            <span className="font-mono text-[#F7D7D1] text-xs font-semibold mt-1 block">
              {analysis && analysis.silencesCount !== undefined
                ? `${analysis.silencesCount} regions`
                : '—'}
            </span>
          </div>

          <div className="bg-[#18191B] p-2.5 rounded-xl border border-[#393B3F]">
            <span className="text-[#FFF5F5]/60 flex items-center space-x-1 text-[11px]">
              <Activity className="w-3 h-3 text-[#F7D7D1]" />
              <span>Scene Cuts</span>
            </span>
            <span className="font-mono text-[#FFF5F5] text-xs font-semibold mt-1 block">
              {analysis && analysis.sceneCutsCount !== undefined
                ? `${analysis.sceneCutsCount} detected`
                : '—'}
            </span>
          </div>

          <div className="bg-[#18191B] p-2.5 rounded-xl border border-[#393B3F]">
            <span className="text-[#FFF5F5]/60 flex items-center space-x-1 text-[11px]">
              <Music className="w-3 h-3 text-[#E3B5BE]" />
              <span>Musical Tempo</span>
            </span>
            <span className="font-mono text-[#F7D7D1] text-xs font-semibold mt-1 block">
              {analysis && analysis.bpm !== undefined
                ? `${analysis.bpm} BPM`
                : '—'}
            </span>
          </div>

          <div className="bg-[#18191B] p-2.5 rounded-xl border border-[#393B3F]">
            <span className="text-[#FFF5F5]/60 flex items-center space-x-1 text-[11px]">
              <Volume2 className="w-3 h-3 text-[#F7D7D1]" />
              <span>Integrated LUFS</span>
            </span>
            <span className="font-mono text-[#FFF5F5] text-xs font-semibold mt-1 block">
              {analysis && analysis.integratedLufs !== undefined
                ? `${analysis.integratedLufs.toFixed(1)} dB`
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Transcript & Dialogue Explorer */}
      <div>
        <div className="flex items-center justify-between text-[#FFF5F5]/80 font-mono text-[11px] font-semibold mb-2">
          <div className="flex items-center space-x-1.5">
            <FileText className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span className="uppercase tracking-wider">Dialogue & Cues ({cues.length})</span>
          </div>
          {cues.length > 0 && (
            <span className="text-[10px] text-[#FFF5F5]/40 font-normal">Click to seek</span>
          )}
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
          {cues.length === 0 ? (
            <div className="text-center py-6 px-4 bg-[#18191B] rounded-xl border border-[#393B3F] space-y-2">
              <div className="w-8 h-8 rounded-lg bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-center mx-auto text-[#E3B5BE]">
                <MicOff className="w-4 h-4 text-[#E3B5BE]" />
              </div>
              <p className="font-semibold text-[#FFF5F5] text-xs">No Dialogue Detected</p>
              <p className="text-[11px] text-[#FFF5F5]/50 leading-relaxed max-w-[220px] mx-auto">
                No spoken dialogue was detected in this clip. Subtitles, AI voiceovers, or
                background music can still be added using the AI Director.
              </p>
            </div>
          ) : (
            cues.map((cue, index) => {
              const startSec = cue.startMs / 1000;
              const endSec = cue.endMs / 1000;
              const isActive = currentSec >= startSec && currentSec <= endSec;

              return (
                <div
                  key={index}
                  onClick={() => setCurrentTime(startSec)}
                  className={`p-2.5 rounded-xl cursor-pointer border transition-all ${
                    isActive
                      ? 'bg-[#E3B5BE]/15 border-[#E3B5BE] text-[#F7D7D1] shadow-sm'
                      : 'bg-[#18191B] border-[#393B3F] hover:border-[#484949] text-[#FFF5F5]/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`font-mono text-[10px] flex items-center space-x-1 ${
                        isActive ? 'text-[#F7D7D1] font-semibold' : 'text-[#FFF5F5]/50'
                      }`}
                    >
                      <PlayCircle className="w-2.5 h-2.5" />
                      <span>
                        {formatTime(cue.startMs)} - {formatTime(cue.endMs)}
                      </span>
                    </span>
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#E3B5BE] animate-pulse" />
                    )}
                  </div>
                  <p
                    className={`text-[11px] leading-relaxed ${
                      isActive ? 'text-[#FFF5F5] font-medium' : 'text-[#FFF5F5]/70'
                    }`}
                  >
                    "{cue.text}"
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Active Edit Plan Overview */}
      <div className="pt-2 border-t border-[#393B3F]">
        <div className="flex items-center justify-between text-[#FFF5F5]/80 font-mono text-[11px] font-semibold mb-2">
          <div className="flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span className="uppercase tracking-wider">Current Plan</span>
          </div>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#2A2C2F] text-[#F7D7D1] border border-[#393B3F]">
            v{effectivePlan?.version ?? 1}
          </span>
        </div>

        <div className="space-y-1">
          {effectivePlan?.layers.map((l) => (
            <div
              key={l.id}
              onClick={() => selectLayer(l.id)}
              className="px-2.5 py-1.5 rounded-lg bg-[#18191B] hover:bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-between cursor-pointer transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#E3B5BE]" />
                <span className="capitalize font-medium text-[#FFF5F5]/90">{l.layer}</span>
              </div>
              <ChevronRight className="w-3 h-3 text-[#FFF5F5]/40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
