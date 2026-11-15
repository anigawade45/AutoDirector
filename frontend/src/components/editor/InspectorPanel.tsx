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
} from 'lucide-react';
import { compare, Operation, applyPatch } from 'fast-json-patch';
import { useEditorStore, selectEffectivePlan } from '../../stores/editorStore';
import { api } from '../../api/client';
import { toast } from '../../stores/toastStore';
import {
  ColorPreset,
  JsonPatchOperation,
  EditLayer,
  COLOR_PRESETS,
  resolveColorParams,
} from '@ai-video/shared';

export const InspectorPanel: React.FC = () => {
  const { project, plan, updateDraft, commitDraft, setPlan, timeline, selectLayer } =
    useEditorStore();

  const effectivePlan = useEditorStore(selectEffectivePlan);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'conflict' | 'error'>('saved');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Selected layer derived from timeline selection or default to first layer
  const selectedLayerId = timeline.selectedLayerIds[0] || effectivePlan?.layers[0]?.id;
  const activeLayer = effectivePlan?.layers.find((l) => l.id === selectedLayerId);

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
          const headV = latest.project?.headVersion ?? latest.headVersion ?? plan.version ?? 1;
          const truePlan = latest.plan || (await api.getPlanVersion(project.id, headV))?.plan;
          if (truePlan) {
            // Attempt smart optimistic rebase of user's local edits onto the newer head plan
            let rebaseSuccess = false;
            try {
              const localPatch = compare(plan.current, plan.draft);
              if (localPatch.length > 0) {
                const rebasedCandidate = JSON.parse(JSON.stringify(truePlan));
                applyPatch(rebasedCandidate, localPatch, false, true);
                const rebasedPatch = compare(truePlan, rebasedCandidate);
                if (rebasedPatch.length > 0) {
                  const rebaseRes = await api.patchPlan(project.id, headV, {
                    patch: rebasedPatch as JsonPatchOperation[],
                    baseVersion: headV,
                  });
                  commitDraft(rebaseRes.plan);
                  setSaveStatus('saved');
                  setStatusMessage(`Auto-synced to v${rebaseRes.plan.version}`);
                  toast.success(`Auto-synced to v${rebaseRes.plan.version}`, 'Rebased');
                  setTimeout(() => setStatusMessage('All changes saved'), 2500);
                  rebaseSuccess = true;
                }
              }
            } catch (rebaseErr) {
              console.warn(
                'Could not cleanly rebase patch onto latest plan, falling back to server state:',
                rebaseErr
              );
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
      const headV = latest.project?.headVersion ?? latest.headVersion ?? plan.version ?? 1;
      const truePlan = latest.plan || (await api.getPlanVersion(project.id, headV))?.plan;
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
            <span className="uppercase tracking-wider">Inspector Layers ({effectivePlan?.layers.length || 0})</span>
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
          {activeLayer.layer === 'color' && (() => {
            const resolvedColor = resolveColorParams(activeLayer.params);
            return (
              <div className="space-y-3.5">
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
                  {activeLayer.params?.reason || 'silence'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-[#222326] p-2.5 rounded-lg border border-[#393B3F]">
                  <span className="text-[#FFF5F5]/50 block text-[10px] font-mono">Start Cut</span>
                  <span className="font-mono text-[#F7D7D1]">
                    {(activeLayer.range?.start || 0).toFixed(2)}s
                  </span>
                </div>
                <div className="bg-[#222326] p-2.5 rounded-lg border border-[#393B3F]">
                  <span className="text-[#FFF5F5]/50 block text-[10px] font-mono">End Cut</span>
                  <span className="font-mono text-[#F7D7D1]">
                    {(activeLayer.range?.end || 0).toFixed(2)}s
                  </span>
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
