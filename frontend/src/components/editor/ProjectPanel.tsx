import React, { useState, useRef, useMemo } from 'react';
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
  Search,
  Users,
  Video,
  Tag,
  Flame,
  Zap,
  Bookmark,
} from 'lucide-react';
import {
  useEditorStore,
  selectEffectivePlan,
  selectMediaIndex,
} from '../../stores/editorStore';
import { api } from '../../api/client';
import { toast } from '../../stores/toastStore';
import { computeNaturalWordTimings } from '../../utils/subtitleTiming';
import { getSpeakerColor, extractTimelineOperations } from '@ai-video/shared';

export const ProjectPanel: React.FC = () => {
  const {
    project,
    playback,
    setCurrentTime,
    selectLayer,
    updateCues,
    deleteCue,
    cleanEmptySubtitleCues,
    renameSpeaker,
    setPlan,
    addChatMessage,
    setChatPending,
  } = useEditorStore();
  const effectivePlan = useEditorStore(selectEffectivePlan);
  const mediaIndex = useEditorStore(selectMediaIndex);

  const [activeTab, setActiveTab] = useState<'transcript' | 'scenes' | 'speakers'>('transcript');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpeakerFilter, setSelectedSpeakerFilter] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Speaker renaming state
  const [renamingSpeakerId, setRenamingSpeakerId] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState('');

  const formatTime = (ms: number) => {
    const totalSec = Math.max(0, ms) / 1000;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const secStr = secs < 10 ? '0' + secs.toFixed(1) : secs.toFixed(1);
    return `${mins}:${secStr}`;
  };

  const currentSec = playback.currentTime;
  const analysis = project?.analysisSummary;
  const cues = analysis?.cues || [];

  const handleUpdateCueText = (index: number, newText: string) => {
    if (!project) return;
    const currentCues = project.analysisSummary?.cues || [];
    const updatedCues = currentCues.map((c, i) => {
      if (i !== index) return c;
      const tokens = newText.trim().split(/\s+/).filter(Boolean);
      const words = computeNaturalWordTimings(tokens, c.startMs, c.endMs, c.words as any);
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
      speaker: selectedSpeakerFilter || 'Speaker 1',
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
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      })
      .catch((err) => {
        console.error('Failed to save added cue:', err);
        setSaveStatus('error');
      });
  };

  const handleDeleteCue = (index: number) => {
    deleteCue(index);
    toast.info('Removed subtitle line', 'Captions');
  };

  const handleCleanEmptyCues = () => {
    const removed = cleanEmptySubtitleCues();
    if (removed > 0) {
      toast.success(`Removed ${removed} empty subtitle cue(s)`, 'Clean Subtitles');
    } else {
      toast.info('No empty cues found', 'Clean Subtitles');
    }
  };

  const handleSaveSpeakerRename = (oldName: string) => {
    const cleanName = newSpeakerName.trim();
    if (!cleanName || cleanName === oldName) {
      setRenamingSpeakerId(null);
      return;
    }
    renameSpeaker(oldName, cleanName);
    setRenamingSpeakerId(null);
    setNewSpeakerName('');
    toast.success(`Renamed "${oldName}" to "${cleanName}" across all cues`, 'Speaker Diarization');
  };

  const handleTriggerPrompt = async (promptMsg: string) => {
    if (!project) return;
    try {
      addChatMessage({ role: 'user', text: promptMsg });
      setChatPending(true);
      toast.info(`Processing "${promptMsg.slice(0, 35)}..."`, 'AI Director');

      const res = await api.submitPrompt(project.id, {
        prompt: promptMsg,
        model: useEditorStore.getState().selectedAiModel,
      });

      if (res?.plan) {
        setPlan(res.plan);
      }
      const ops = res?.plan ? (extractTimelineOperations(res.plan).operations as any) : undefined;
      addChatMessage({
        role: 'assistant',
        text: `Applied edit plan v${res?.plan?.version || 'next'} for: "${promptMsg}".`,
        planVersion: res?.plan?.version,
        operations: ops,
      });
      toast.success(`Plan updated to v${res?.plan?.version || 1}!`, 'AI Director');
    } catch (err: any) {
      toast.error(err.message || 'Failed to process AI prompt', 'AI Director');
    } finally {
      setChatPending(false);
    }
  };

  // Filtered dialogue cues
  const filteredCues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cues.map((cue, originalIndex) => ({ cue, originalIndex })).filter(({ cue }) => {
      if (selectedSpeakerFilter && (cue.speaker || 'Speaker 1') !== selectedSpeakerFilter) {
        return false;
      }
      if (q) {
        const textMatch = (cue.text || '').toLowerCase().includes(q);
        const wordMatch = cue.words?.some((w: any) =>
          ((w as any).word || (w as any).w || '').toLowerCase().includes(q)
        );
        return textMatch || wordMatch;
      }
      return true;
    });
  }, [cues, searchQuery, selectedSpeakerFilter]);

  return (
    <div className="h-full flex flex-col p-4 space-y-4 overflow-y-auto custom-scrollbar select-none text-xs">
      {/* Media Metadata Card */}
      <div className="bg-[#18191B] p-3 rounded-xl border border-[#393B3F] space-y-2.5">
        <div className="flex items-center justify-between text-[#FFF5F5]/60 font-mono text-[11px]">
          <span className="flex items-center space-x-1">
            <Film className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span>SOURCE ASSET</span>
          </span>
          <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-[#2A2C2F] text-[#F7D7D1] border border-[#393B3F]">
            {project?.status || 'Active'}
          </span>
        </div>

        <div>
          <h3 className="font-semibold text-sm text-[#FFF5F5] truncate" title={project?.title}>
            {project?.title || 'Untitled Sequence'}
          </h3>
          <p className="text-[#FFF5F5]/40 font-mono text-[10px] truncate mt-0.5">
            ID: {project?.id || '—'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#393B3F]/60 text-[11px]">
          <div className="space-y-0.5">
            <span className="text-[#FFF5F5]/50 block">Resolution</span>
            <span className="font-mono text-[#FFF5F5] font-medium">
              {project?.media?.width || 1920}x{project?.media?.height || 1080}
            </span>
          </div>
          <div className="space-y-0.5">
            <span className="text-[#FFF5F5]/50 block">Framerate</span>
            <span className="font-mono text-[#FFF5F5] font-medium">{project?.fps || 30} FPS</span>
          </div>
          <div className="space-y-0.5">
            <span className="text-[#FFF5F5]/50 block">Duration</span>
            <span className="font-mono text-[#FFF5F5] font-medium">
              {(playback.duration || project?.durationSec || 0).toFixed(2)}s
            </span>
          </div>
          <div className="space-y-0.5">
            <span className="text-[#FFF5F5]/50 block">Aspect Ratio</span>
            <span className="font-mono text-[#FFF5F5] font-medium">{project?.aspect || '16:9'}</span>
          </div>
        </div>
      </div>

      {/* Multimodal Index Explorer: Tabs for Transcript, Scenes, and Speakers */}
      <div className="bg-[#18191B] rounded-xl border border-[#393B3F] p-3 space-y-3">
        {/* Navigation Header with Status Indicator */}
        <div className="flex items-center justify-between text-xs font-semibold text-[#FFF5F5]">
          <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px] text-[#FFF5F5]/70 font-mono">
            <Sparkles className="w-3 h-3 text-[#E3B5BE]" />
            <span>Media Indexing</span>
          </span>

          {saveStatus === 'saving' && (
            <span className="flex items-center space-x-1 text-[10px] text-[#E3B5BE] font-mono">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              <span>Syncing</span>
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center space-x-1 text-[10px] text-emerald-400 font-mono">
              <Check className="w-2.5 h-2.5" />
              <span>Saved</span>
            </span>
          )}
        </div>

        {/* 3 Full-Width Equal Segmented Tabs */}
        <div className="grid grid-cols-3 gap-1 bg-[#121314] p-1 rounded-xl border border-[#393B3F]/70">
          <button
            type="button"
            onClick={() => setActiveTab('transcript')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-1.5 rounded-lg text-[11px] font-semibold transition-all min-w-0 whitespace-nowrap overflow-hidden select-none ${
              activeTab === 'transcript'
                ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm'
                : 'text-[#FFF5F5]/70 hover:text-white hover:bg-white/5'
            }`}
            title={`Transcript Cues (${cues.length})`}
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Transcript</span>
            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded-full shrink-0 font-bold ${
              activeTab === 'transcript' ? 'bg-[#18191B]/20 text-[#18191B]' : 'bg-white/10 text-[#FFF5F5]/60'
            }`}>
              {cues.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('scenes')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-1.5 rounded-lg text-[11px] font-semibold transition-all min-w-0 whitespace-nowrap overflow-hidden select-none ${
              activeTab === 'scenes'
                ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm'
                : 'text-[#FFF5F5]/70 hover:text-white hover:bg-white/5'
            }`}
            title={`Scene Cuts (${mediaIndex.scenes.length})`}
          >
            <Video className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Scenes</span>
            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded-full shrink-0 font-bold ${
              activeTab === 'scenes' ? 'bg-[#18191B]/20 text-[#18191B]' : 'bg-white/10 text-[#FFF5F5]/60'
            }`}>
              {mediaIndex.scenes.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('speakers')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-1.5 rounded-lg text-[11px] font-semibold transition-all min-w-0 whitespace-nowrap overflow-hidden select-none ${
              activeTab === 'speakers'
                ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm'
                : 'text-[#FFF5F5]/70 hover:text-white hover:bg-white/5'
            }`}
            title={`Speakers Diarization (${mediaIndex.speakers.length})`}
          >
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Speakers</span>
            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded-full shrink-0 font-bold ${
              activeTab === 'speakers' ? 'bg-[#18191B]/20 text-[#18191B]' : 'bg-white/10 text-[#FFF5F5]/60'
            }`}>
              {mediaIndex.speakers.length}
            </span>
          </button>
        </div>

        {/* Tab 1: Transcript & Dialogue */}
        {activeTab === 'transcript' && (
          <div className="space-y-2.5">
            {/* Search & Actions Bar */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3 h-3 absolute left-2 top-2 text-[#FFF5F5]/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search dialogue words..."
                  className="w-full bg-[#121314] text-[#FFF5F5] pl-7 pr-2 py-1 rounded-lg text-[11px] border border-[#393B3F] focus:border-[#E3B5BE] focus:outline-none"
                />
              </div>

              {cues.some((c) => !(c.text || '').replace(/^["'\s]+|["'\s]+$/g, '').trim()) && (
                <button
                  type="button"
                  onClick={handleCleanEmptyCues}
                  className="px-2 py-1 rounded text-[10px] bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-800/40 flex items-center space-x-1 shrink-0"
                  title="Remove empty subtitle cues"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                  <span>Clean</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className="px-2 py-1 rounded text-[10px] bg-[#222326] hover:bg-[#2A2C2F] text-[#FFF5F5] border border-[#393B3F] flex items-center space-x-1 shrink-0"
              >
                {isEditing ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Edit3 className="w-2.5 h-2.5 text-[#E3B5BE]" />}
                <span>{isEditing ? 'Done' : 'Edit'}</span>
              </button>

              {isEditing && (
                <button
                  type="button"
                  onClick={handleAddCueLine}
                  className="px-2 py-1 rounded text-[10px] bg-[#E3B5BE] text-[#18191B] font-bold flex items-center space-x-0.5 shrink-0"
                  title="Add cue at playhead"
                >
                  <Plus className="w-2.5 h-2.5" />
                  <span>Add</span>
                </button>
              )}
            </div>

            {/* Active Speaker Filter Chip */}
            {selectedSpeakerFilter && (
              <div className="flex items-center justify-between bg-[#141517] px-2 py-1 rounded-lg border border-[#E3B5BE]/30 text-[10px]">
                <span className="text-[#FFF5F5]/70 flex items-center gap-1.5 truncate">
                  <span className="text-[#FFF5F5]/40">Filter:</span>
                  <span className="font-semibold text-[#F7D7D1]">{selectedSpeakerFilter}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSpeakerFilter(null)}
                  className="text-[#FFF5F5]/50 hover:text-white px-1 font-mono"
                  title="Clear speaker filter"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Cue List */}
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
              {filteredCues.length === 0 ? (
                <div className="text-center py-6 px-4 bg-[#121314] rounded-xl border border-[#393B3F]/60 space-y-1.5">
                  <MicOff className="w-5 h-5 mx-auto text-[#FFF5F5]/40" />
                  <p className="font-semibold text-xs text-[#FFF5F5]">No matching dialogue cues</p>
                  <p className="text-[10px] text-[#FFF5F5]/40">
                    Try clearing the search query or click "+ Add" to create a caption.
                  </p>
                </div>
              ) : (
                filteredCues.map(({ cue, originalIndex }) => {
                  const startSec = cue.startMs / 1000;
                  const endSec = cue.endMs / 1000;
                  const isActive = currentSec >= startSec && currentSec <= endSec;
                  const speaker = (cue.speaker || 'Speaker 1').trim();
                  const speakerColor = getSpeakerColor(speaker);

                  return (
                    <div
                      key={cue.id || originalIndex}
                      style={{ borderLeftColor: speakerColor, borderLeftWidth: '3px' }}
                      className={`p-2 rounded-lg border transition-all ${
                        isActive
                          ? 'bg-[#E3B5BE]/15 border-[#E3B5BE] text-[#F7D7D1] shadow-sm'
                          : 'bg-[#121314] border-[#393B3F]/70 hover:border-[#484949] text-[#FFF5F5]/80'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => setCurrentTime(startSec)}
                            className="font-mono text-[10px] flex items-center space-x-1 text-[#E3B5BE] hover:underline"
                          >
                            <PlayCircle className="w-2.5 h-2.5" />
                            <span>
                              {formatTime(cue.startMs)} - {formatTime(cue.endMs)}
                            </span>
                          </button>
                          <span
                            onClick={() => setSelectedSpeakerFilter(speaker)}
                            className="text-[9px] font-mono px-1 rounded bg-[#2A2C2F] text-[#FFF5F5]/70 hover:text-white cursor-pointer"
                            title="Filter by this speaker"
                          >
                            {speaker}
                          </span>
                        </div>

                        {isEditing && (
                          <button
                            type="button"
                            onClick={() => handleDeleteCue(originalIndex)}
                            className="text-[#FFF5F5]/30 hover:text-red-400 p-0.5"
                            title="Delete cue"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>

                      {isEditing ? (
                        <textarea
                          rows={2}
                          value={cue.text}
                          onChange={(e) => handleUpdateCueText(originalIndex, e.target.value)}
                          className="w-full bg-[#18191B] border border-[#393B3F] focus:border-[#E3B5BE] rounded p-1.5 text-xs text-[#FFF5F5] resize-none focus:outline-none"
                        />
                      ) : (
                        <p
                          onClick={() => setCurrentTime(startSec)}
                          className="text-[11px] leading-relaxed cursor-pointer hover:text-white"
                        >
                          {cue.text?.trim() ? (
                            `"${cue.text.trim()}"`
                          ) : (
                            <span className="text-red-400 italic">[Empty Caption — Click Edit to add text]</span>
                          )}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Visual Scenes */}
        {activeTab === 'scenes' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#FFF5F5]/60 mb-1">
              <span>Detected Scenes ({mediaIndex.scenes.length})</span>
              <span>Click scene to jump</span>
            </div>

            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
              {mediaIndex.scenes.map((scene) => {
                const isActive = currentSec >= scene.startSec && currentSec < scene.endSec;

                return (
                  <div
                    key={scene.id}
                    onClick={() => setCurrentTime(scene.startSec)}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                      isActive
                        ? 'bg-[#E3B5BE]/20 border-[#E3B5BE] shadow-md'
                        : 'bg-[#121314] border-[#393B3F]/70 hover:border-[#484949]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-semibold text-xs text-[#FFF5F5]">
                          Scene {scene.index}
                        </span>
                        <span className="font-mono text-[10px] text-[#F7D7D1]">
                          ({scene.startSec.toFixed(1)}s - {scene.endSec.toFixed(1)}s)
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-[#FFF5F5]/50">
                        {scene.durationSec.toFixed(1)}s duration
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-[#FFF5F5]/60 mt-1">
                      <span>{scene.cues.length} dialogue cue(s)</span>
                      <div className="flex items-center space-x-1">
                        {scene.speakers.map((spk) => (
                          <span
                            key={spk}
                            style={{ backgroundColor: getSpeakerColor(spk) }}
                            className="w-2 h-2 rounded-full"
                            title={spk}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Speaker Diarization & Metrics */}
        {activeTab === 'speakers' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#FFF5F5]/60 mb-1">
              <span>Speakers & Dialogue Breakdown</span>
              <span>{mediaIndex.speakerTurnCount} speaker turns</span>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
              {mediaIndex.speakers.map((spk) => {
                const isRenaming = renamingSpeakerId === spk.id;

                return (
                  <div
                    key={spk.id}
                    className="p-2.5 rounded-lg bg-[#121314] border border-[#393B3F]/70 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span
                          style={{ backgroundColor: spk.color }}
                          className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                        />
                        {isRenaming ? (
                          <div className="flex items-center space-x-1">
                            <input
                              type="text"
                              value={newSpeakerName}
                              onChange={(e) => setNewSpeakerName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveSpeakerRename(spk.name);
                                else if (e.key === 'Escape') setRenamingSpeakerId(null);
                              }}
                              autoFocus
                              className="w-28 bg-[#18191B] text-[#FFF5F5] px-1.5 py-0.5 rounded text-xs border border-[#E3B5BE] focus:outline-none"
                            />
                            <button
                              onClick={() => handleSaveSpeakerRename(spk.name)}
                              className="px-2 py-0.5 rounded bg-[#E3B5BE] text-[#18191B] font-bold text-[10px]"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setRenamingSpeakerId(null)}
                              className="text-[#FFF5F5]/40 hover:text-white text-[10px]"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1.5">
                            <span className="font-semibold text-xs text-[#FFF5F5]">{spk.name}</span>
                            <button
                              onClick={() => {
                                setRenamingSpeakerId(spk.id);
                                setNewSpeakerName(spk.name);
                              }}
                              className="text-[#FFF5F5]/40 hover:text-[#E3B5BE] p-0.5"
                              title="Rename speaker"
                            >
                              <Edit3 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          setSelectedSpeakerFilter(spk.name);
                          setActiveTab('transcript');
                        }}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#2A2C2F] text-[#F7D7D1] hover:bg-[#34373B]"
                      >
                        Filter dialogue
                      </button>
                    </div>

                    {/* Progress Bar of Dialogue Percentage */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#FFF5F5]/60">
                        <span>Speaking Time: {(spk.totalSpeakingMs / 1000).toFixed(1)}s</span>
                        <span>{spk.percentageOfDialogue}% of dialogue</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#2A2C2F] rounded-full overflow-hidden">
                        <div
                          style={{
                            width: `${spk.percentageOfDialogue}%`,
                            backgroundColor: spk.color,
                          }}
                          className="h-full rounded-full transition-all"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-[#FFF5F5]/50 font-mono">
                      <span>{spk.cuesCount} cues • {spk.wordCount} words</span>
                      <span>Active in {spk.sceneIndices.length} scene(s)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* AI Discovery: Hooks, Chapters & Short-Form Extraction */}
      <div className="bg-[#18191B] rounded-xl border border-[#393B3F] p-3 space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-[#FFF5F5]">
          <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px] text-[#FFF5F5]/70 font-mono">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <span>AI Discovery & Viral Hooks</span>
          </span>
          <span className="text-[10px] text-amber-400 font-mono bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
            Multimodal AI
          </span>
        </div>

        {/* Viral Hook Card */}
        {analysis?.hook && (
          <div className="bg-[#121314] rounded-lg border border-amber-400/30 p-2.5 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 font-semibold text-amber-300">
                <Zap className="w-3 h-3 text-amber-400" />
                <span>Viral Hook Segment</span>
              </span>
              <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200 font-bold">
                {Math.round((analysis.hook.score || 0.95) * 100)}% Match
              </span>
            </div>
            <p className="text-[11px] text-[#FFF5F5]/80 italic">
              "{analysis.hook.reason || 'High-cadence opening delivery'}"
            </p>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] font-mono text-[#FFF5F5]/60 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {formatTime(analysis.hook.startMs)} - {formatTime(analysis.hook.endMs)}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentTime(analysis.hook!.startMs / 1000)}
                  className="px-2 py-1 rounded text-[10px] font-mono bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-colors"
                >
                  Play Hook
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleTriggerPrompt('Extract 60s viral TikTok short (9:16) from this hook')
                  }
                  className="px-2 py-1 rounded text-[10px] font-semibold bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-black shadow-sm transition-all flex items-center gap-1"
                >
                  <Zap className="w-2.5 h-2.5" />
                  <span>9:16 Short</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Semantic Chapters */}
        {analysis?.chapters && analysis.chapters.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-[#FFF5F5]/50 font-mono uppercase tracking-wider">
              <span className="flex items-center gap-1">
                <Bookmark className="w-3 h-3 text-[#E3B5BE]" />
                <span>Video Chapters ({analysis.chapters.length})</span>
              </span>
            </div>
            <div className="space-y-1">
              {analysis.chapters.map((ch, idx) => (
                <div
                  key={ch.id || idx}
                  onClick={() => setCurrentTime(ch.startMs / 1000)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#121314] hover:bg-[#2A2C2F] border border-[#393B3F]/60 flex items-center justify-between cursor-pointer transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[9.5px] font-mono text-[#E3B5BE] shrink-0">
                      {formatTime(ch.startMs)}
                    </span>
                    <span className="text-[11px] font-medium text-[#FFF5F5]/90 group-hover:text-white truncate">
                      {ch.title}
                    </span>
                  </div>
                  <ChevronRight className="w-3 h-3 text-[#FFF5F5]/30 group-hover:text-[#E3B5BE] group-hover:translate-x-0.5 transition-transform shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reference-Style Transfer Quick Archetypes */}
        <div className="pt-1 border-t border-[#393B3F]/50 space-y-1.5">
          <p className="text-[10px] text-[#FFF5F5]/50 font-mono font-semibold uppercase tracking-wider">
            Reference-Style Transfer (No Media Cloned)
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() =>
                handleTriggerPrompt(
                  'Apply Alex Hormozi style: snappy cuts, high contrast, bold yellow word-pop subtitles, ducked music'
                )
              }
              className="px-2 py-1.5 rounded-lg bg-[#121314] hover:bg-[#2A2C2F] border border-[#393B3F] hover:border-[#E3B5BE]/60 text-left transition-colors"
            >
              <div className="text-[10.5px] font-semibold text-[#FFF5F5]">Hormozi Style</div>
              <div className="text-[9px] text-[#FFF5F5]/50 font-mono truncate">
                Fast cuts & yellow pop
              </div>
            </button>
            <button
              type="button"
              onClick={() =>
                handleTriggerPrompt(
                  'Apply Ali Abdaal aesthetic: warm film grade, clean minimal Inter captions, gentle lo-fi music'
                )
              }
              className="px-2 py-1.5 rounded-lg bg-[#121314] hover:bg-[#2A2C2F] border border-[#393B3F] hover:border-[#E3B5BE]/60 text-left transition-colors"
            >
              <div className="text-[10.5px] font-semibold text-[#FFF5F5]">Ali Abdaal Style</div>
              <div className="text-[9px] text-[#FFF5F5]/50 font-mono truncate">
                Warm film & clean Inter
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Active Edit Plan Layers Overview */}
      <div className="bg-[#18191B] rounded-xl border border-[#393B3F] p-3 space-y-2">
        <div className="flex items-center justify-between text-[#FFF5F5]/80 font-mono text-[11px] font-semibold">
          <div className="flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-[#E3B5BE]" />
            <span className="uppercase tracking-wider">Active Sequence Layers</span>
          </div>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#2A2C2F] text-[#F7D7D1] border border-[#393B3F]">
            v{effectivePlan?.version ?? 1}
          </span>
        </div>

        {(() => {
          const opsSummary = effectivePlan ? extractTimelineOperations(effectivePlan) : null;
          const ops = opsSummary?.operations || [];

          if (ops.length === 0) {
            return (
              <p className="text-[11px] text-[#FFF5F5]/40 italic py-2 text-center">
                No active edit layers in sequence
              </p>
            );
          }

          // Windowed rendering for high-volume 500+ operations scaling to keep DOM lightweight
          const displayedOps = ops.slice(0, 100);

          return (
            <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-0.5">
              {displayedOps.map((op) => (
                <div
                  key={op.id}
                  onClick={() => {
                    if (op.startSec !== undefined) {
                      setCurrentTime(op.startSec);
                    }
                    selectLayer(op.id);
                  }}
                  className="px-2.5 py-2 rounded-lg bg-[#121314] hover:bg-[#2A2C2F] border border-[#393B3F]/70 hover:border-[#E3B5BE]/60 flex flex-col gap-1 cursor-pointer transition-colors group"
                  title={`Select ${op.title} (${op.trackName})`}
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[#F7D7D1] text-[9px] font-medium">
                      {op.trackName}
                    </span>
                    {op.startSec !== undefined && (
                      <span className="font-mono text-[#FFF5F5]/60 text-[9px] flex items-center gap-1 group-hover:text-[#E3B5BE]">
                        <Clock className="w-2.5 h-2.5" />
                        {op.startSec.toFixed(1)}s{op.endSec !== undefined ? ` - ${op.endSec.toFixed(1)}s` : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-[#FFF5F5] group-hover:text-white">
                      {op.title}
                    </span>
                    <ChevronRight className="w-3 h-3 text-[#FFF5F5]/30 group-hover:text-[#E3B5BE] group-hover:translate-x-0.5 transition-transform shrink-0" />
                  </div>
                  <p className="text-[10px] text-[#FFF5F5]/60 truncate font-mono">
                    {op.summary}
                  </p>
                </div>
              ))}
              {ops.length > 100 && (
                <div className="text-[10px] font-mono text-[#FFF5F5]/50 text-center py-1.5 bg-white/5 rounded border border-white/10">
                  Showing 100 of {ops.length} operations (UI scaled at 60fps)
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
};
