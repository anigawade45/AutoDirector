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

  // Mock cues if none provided, to ensure interactive dialogue exploration
  const cues = analysis?.cues || [
    {
      startMs: 1200,
      endMs: 4500,
      text: 'Welcome to our vacation in Goa. Exploring the beaches and golden sunsets.',
      words: [
        { word: 'Welcome', startMs: 1200, endMs: 1600 },
        { word: 'to', startMs: 1650, endMs: 1800 },
        { word: 'our', startMs: 1850, endMs: 2000 },
        { word: 'vacation', startMs: 2050, endMs: 2600 },
        { word: 'in', startMs: 2650, endMs: 2800 },
        { word: 'Goa.', startMs: 2850, endMs: 3300 },
        { word: 'Exploring', startMs: 3400, endMs: 3900 },
        { word: 'the', startMs: 3950, endMs: 4100 },
        { word: 'beaches', startMs: 4150, endMs: 4500 },
      ],
    },
    {
      startMs: 5100,
      endMs: 9800,
      text: 'The waves crashing against the rocky cliffs created such a stunning peaceful atmosphere.',
      words: [
        { word: 'The', startMs: 5100, endMs: 5300 },
        { word: 'waves', startMs: 5350, endMs: 5700 },
        { word: 'crashing', startMs: 5750, endMs: 6200 },
        { word: 'against', startMs: 6250, endMs: 6600 },
        { word: 'the', startMs: 6650, endMs: 6800 },
        { word: 'rocky', startMs: 6850, endMs: 7200 },
        { word: 'cliffs', startMs: 7250, endMs: 7700 },
        { word: 'peaceful', startMs: 8400, endMs: 9100 },
        { word: 'atmosphere.', startMs: 9150, endMs: 9800 },
      ],
    },
    {
      startMs: 10500,
      endMs: 14200,
      text: 'Later in the evening, we stopped by the famous beach shacks for local seafood.',
      words: [
        { word: 'Later', startMs: 10500, endMs: 10900 },
        { word: 'in', startMs: 10950, endMs: 11100 },
        { word: 'the', startMs: 11150, endMs: 11300 },
        { word: 'evening,', startMs: 11350, endMs: 11800 },
        { word: 'we', startMs: 11850, endMs: 12000 },
        { word: 'stopped', startMs: 12050, endMs: 12450 },
        { word: 'by', startMs: 12500, endMs: 12650 },
        { word: 'local', startMs: 13300, endMs: 13700 },
        { word: 'seafood.', startMs: 13750, endMs: 14200 },
      ],
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 select-none text-xs">
      {/* Project & Media Info Card */}
      <div className="bg-[#0B0F17] rounded-xl p-3 border border-surfaceBorder space-y-2.5">
        <div className="flex items-center justify-between text-slate-300">
          <div className="flex items-center space-x-1.5 font-semibold">
            <Film className="w-3.5 h-3.5 text-blue-400" />
            <span className="truncate max-w-[150px]">{project?.title || 'Project'}</span>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-400 font-mono">
            {project?.status || 'ready'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-800/80">
          <div>
            <span className="text-slate-500 block text-[10px]">Resolution</span>
            <span className="font-mono text-slate-300">
              {project?.media ? `${project.media.width}x${project.media.height}` : '1920x1080'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">Frame Rate</span>
            <span className="font-mono text-slate-300">{project?.fps || 30} FPS</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">Aspect Ratio</span>
            <span className="font-mono text-slate-300">{project?.aspect || '16:9'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">Duration</span>
            <span className="font-mono text-slate-300">
              {formatTime((project?.durationSec || 60) * 1000)}
            </span>
          </div>
        </div>

        {project?.assetId && (
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center space-x-1">
              <HardDrive className="w-3 h-3 text-slate-500" />
              <span>Base Asset</span>
            </span>
            <span className="font-mono text-slate-300 truncate max-w-[120px]">
              {project.assetId}
            </span>
          </div>
        )}
      </div>

      {/* Media Analysis Summary */}
      <div>
        <div className="flex items-center space-x-2 text-slate-300 font-semibold mb-2.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>AI Media Intelligence</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[#0B0F17] p-2.5 rounded-xl border border-surfaceBorder">
            <span className="text-slate-400 flex items-center space-x-1 text-[11px]">
              <Scissors className="w-3 h-3 text-amber-400" />
              <span>Silences</span>
            </span>
            <span className="font-mono text-slate-200 text-xs font-semibold mt-1 block">
              {analysis?.silencesCount ?? 4} regions
            </span>
          </div>

          <div className="bg-[#0B0F17] p-2.5 rounded-xl border border-surfaceBorder">
            <span className="text-slate-400 flex items-center space-x-1 text-[11px]">
              <Activity className="w-3 h-3 text-cyan-400" />
              <span>Scene Cuts</span>
            </span>
            <span className="font-mono text-slate-200 text-xs font-semibold mt-1 block">
              {analysis?.sceneCutsCount ?? 7} detected
            </span>
          </div>

          <div className="bg-[#0B0F17] p-2.5 rounded-xl border border-surfaceBorder">
            <span className="text-slate-400 flex items-center space-x-1 text-[11px]">
              <Music className="w-3 h-3 text-emerald-400" />
              <span>Musical Tempo</span>
            </span>
            <span className="font-mono text-slate-200 text-xs font-semibold mt-1 block">
              {analysis?.bpm ?? 124} BPM
            </span>
          </div>

          <div className="bg-[#0B0F17] p-2.5 rounded-xl border border-surfaceBorder">
            <span className="text-slate-400 flex items-center space-x-1 text-[11px]">
              <Volume2 className="w-3 h-3 text-violet-400" />
              <span>Integrated LUFS</span>
            </span>
            <span className="font-mono text-slate-200 text-xs font-semibold mt-1 block">
              {(analysis?.integratedLufs ?? -15.8).toFixed(1)} dB
            </span>
          </div>
        </div>
      </div>

      {/* Transcript & Dialogue Explorer */}
      <div>
        <div className="flex items-center justify-between text-slate-300 font-semibold mb-2">
          <div className="flex items-center space-x-1.5">
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span>Dialogue & Cues ({cues.length})</span>
          </div>
          <span className="text-[10px] text-slate-500 font-normal">Click to seek</span>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {cues.map((cue, index) => {
            const startSec = cue.startMs / 1000;
            const endSec = cue.endMs / 1000;
            const isActive = currentSec >= startSec && currentSec <= endSec;

            return (
              <div
                key={index}
                onClick={() => setCurrentTime(startSec)}
                className={`p-2.5 rounded-xl cursor-pointer border transition-all ${
                  isActive
                    ? 'bg-blue-600/15 border-blue-500 shadow-sm shadow-blue-500/10'
                    : 'bg-[#0B0F17] border-surfaceBorder hover:border-slate-700 hover:bg-slate-900/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`font-mono text-[10px] flex items-center space-x-1 ${
                      isActive ? 'text-blue-300 font-semibold' : 'text-slate-400'
                    }`}
                  >
                    <PlayCircle className="w-2.5 h-2.5" />
                    <span>
                      {formatTime(cue.startMs)} - {formatTime(cue.endMs)}
                    </span>
                  </span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  )}
                </div>
                <p
                  className={`text-[11px] leading-relaxed ${
                    isActive ? 'text-white font-medium' : 'text-slate-300'
                  }`}
                >
                  "{cue.text}"
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Edit Plan Overview */}
      <div className="pt-2 border-t border-surfaceBorder">
        <div className="flex items-center justify-between text-slate-300 font-semibold mb-2">
          <div className="flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            <span>Current Plan</span>
          </div>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
            v{effectivePlan?.version ?? 1}
          </span>
        </div>

        <div className="space-y-1">
          {effectivePlan?.layers.map((l) => (
            <div
              key={l.id}
              onClick={() => selectLayer(l.id)}
              className="px-2.5 py-1.5 rounded-lg bg-[#0B0F17] hover:bg-slate-900 border border-surfaceBorder flex items-center justify-between cursor-pointer transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                <span className="capitalize font-medium text-slate-300">{l.layer}</span>
              </div>
              <ChevronRight className="w-3 h-3 text-slate-500" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
