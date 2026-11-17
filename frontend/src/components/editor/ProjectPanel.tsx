import React, { useState, useRef } from 'react';
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
  Edit3,
  Check,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEditorStore, selectEffectivePlan } from '../../stores/editorStore';
import { api } from '../../api/client';
import { toast } from '../../stores/toastStore';

export const ProjectPanel: React.FC = () => {
  const { project, playback, setCurrentTime, selectLayer, updateCues } = useEditorStore();
  const effectivePlan = useEditorStore(selectEffectivePlan);
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

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

  const handleUpdateCueText = (index: number, newText: string) => {
    if (!project) return;
    const currentCues = project.analysisSummary?.cues || [];
    const updatedCues = currentCues.map((c, i) => {
      if (i !== index) return c;
      const tokens = newText.trim().split(/\s+/).filter(Boolean);
      const totalDur = c.endMs - c.startMs;
      const perWordDur =
        tokens.length > 0 ? Math.max(100, Math.floor(totalDur / tokens.length)) : 100;
      const words = tokens.map((tok, tIdx) => ({
        word: tok,
        startMs: c.startMs + tIdx * perWordDur,
        endMs: tIdx === tokens.length - 1 ? c.endMs : c.startMs + (tIdx + 1) * perWordDur,
        score: 1,
      }));
      return {
        ...c,
        text: newText,
        words,
      };
    });

    updateCues(updatedCues);

    setSaveStatus('saving');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await api.updateCaptions(project.id, updatedCues);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      } catch (err: any) {
        console.error('Failed to sync captions:', err);
        setSaveStatus('error');
        toast.error(
          'Failed to save subtitle edits: ' + (err.message || 'Unknown error'),
          'Captions Sync'
        );
      }
    }, 600);
  };

  const handleAddCueLine = () => {
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

    api.updateCaptions(project.id, currentCues).catch((err) => {
      console.error('Failed to save added cue:', err);
    });
  };

  const handleDeleteCue = (index: number) => {
    if (!project) return;
    const currentCues = project.analysisSummary?.cues || [];
    const updatedCues = currentCues.filter((_, i) => i !== index);

    updateCues(updatedCues);
    toast.info('Removed subtitle line', 'Captions');

    api.updateCaptions(project.id, updatedCues).catch((err) => {
      console.error('Failed to save deleted cue:', err);
    });
  };

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
            <span className="text-[#FFF5F5]/80 truncate max-w-[120px]">{project.assetId}</span>
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
              {analysis && analysis.bpm !== undefined ? `${analysis.bpm} BPM` : '—'}
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
          <div className="flex items-center space-x-2">
            {saveStatus === 'saving' && (
              <span className="flex items-center space-x-1 text-[10px] text-[#E3B5BE]">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                <span>Saving</span>
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="flex items-center space-x-1 text-[10px] text-emerald-400">
                <Check className="w-2.5 h-2.5" />
                <span>Saved</span>
              </span>
            )}
            {isEditing && (
              <button
                type="button"
                onClick={handleAddCueLine}
                className="px-1.5 py-0.5 rounded text-[10px] bg-[#E3B5BE]/15 hover:bg-[#E3B5BE]/25 text-[#F7D7D1] border border-[#E3B5BE]/40 flex items-center space-x-0.5 transition-colors"
                title="Add a subtitle line"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>Add</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className="px-2 py-0.5 rounded text-[10px] bg-[#222326] hover:bg-[#2A2C2F] text-[#FFF5F5] border border-[#393B3F] flex items-center space-x-1 transition-colors"
            >
              {isEditing ? (
                <>
                  <Check className="w-2.5 h-2.5 text-emerald-400" />
                  <span>Done</span>
                </>
              ) : (
                <>
                  <Edit3 className="w-2.5 h-2.5 text-[#E3B5BE]" />
                  <span>Edit</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
          {cues.length === 0 ? (
            <div className="text-center py-6 px-4 bg-[#18191B] rounded-xl border border-[#393B3F] space-y-2">
              <div className="w-8 h-8 rounded-lg bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-center mx-auto text-[#E3B5BE]">
                <MicOff className="w-4 h-4 text-[#E3B5BE]" />
              </div>
              <p className="font-semibold text-[#FFF5F5] text-xs">No Dialogue Detected</p>
              <p className="text-[11px] text-[#FFF5F5]/50 leading-relaxed max-w-[220px] mx-auto">
                No spoken dialogue was detected in this clip. Click "Edit" or "+ Add" to create
                subtitles manually.
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(true);
                  handleAddCueLine();
                }}
                className="px-3 py-1 rounded-lg text-xs bg-[#E3B5BE] text-[#18191B] font-medium hover:bg-[#E3B5BE]/90 transition-colors"
              >
                + Add Subtitle Line
              </button>
            </div>
          ) : (
            cues.map((cue, index) => {
              const startSec = cue.startMs / 1000;
              const endSec = cue.endMs / 1000;
              const isActive = currentSec >= startSec && currentSec <= endSec;

              return (
                <div
                  key={cue.id || index}
                  className={`p-2.5 rounded-xl border transition-all ${
                    isActive
                      ? 'bg-[#E3B5BE]/15 border-[#E3B5BE] text-[#F7D7D1] shadow-sm'
                      : 'bg-[#18191B] border-[#393B3F] hover:border-[#484949] text-[#FFF5F5]/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <button
                      type="button"
                      onClick={() => setCurrentTime(startSec)}
                      className={`font-mono text-[10px] flex items-center space-x-1 hover:underline ${
                        isActive ? 'text-[#F7D7D1] font-semibold' : 'text-[#FFF5F5]/50'
                      }`}
                      title="Seek to cue"
                    >
                      <PlayCircle className="w-2.5 h-2.5 text-[#E3B5BE]" />
                      <span>
                        {formatTime(cue.startMs)} - {formatTime(cue.endMs)}
                      </span>
                    </button>
                    <div className="flex items-center space-x-1.5">
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#E3B5BE] animate-pulse" />
                      )}
                      {isEditing && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCue(index)}
                          className="text-[#FFF5F5]/30 hover:text-red-400 p-0.5 transition-colors"
                          title="Delete line"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <textarea
                      rows={2}
                      value={cue.text}
                      onChange={(e) => handleUpdateCueText(index, e.target.value)}
                      placeholder="Enter subtitle text..."
                      className="w-full bg-[#18191B] border border-[#393B3F] focus:border-[#E3B5BE] rounded p-1.5 text-xs text-[#FFF5F5] placeholder-[#FFF5F5]/30 resize-none focus:outline-none transition-colors"
                    />
                  ) : (
                    <p
                      onClick={() => setCurrentTime(startSec)}
                      className={`text-[11px] leading-relaxed cursor-pointer ${
                        isActive ? 'text-[#FFF5F5] font-medium' : 'text-[#FFF5F5]/70'
                      }`}
                    >
                      "{cue.text}"
                    </p>
                  )}
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
