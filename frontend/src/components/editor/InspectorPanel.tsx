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
} from 'lucide-react';
import { compare, Operation } from 'fast-json-patch';
import { useEditorStore, selectEffectivePlan } from '../../stores/editorStore';
import { api } from '../../api/client';
import { ColorPreset, JsonPatchOperation, EditLayer } from '@ai-video/shared';

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

      const response = await api.patchPlan(project.id, plan.version, {
        patch: patch as JsonPatchOperation[],
        baseVersion: plan.version,
      });

      commitDraft(response.plan);
      setSaveStatus('saved');
      setStatusMessage('All changes saved');
    } catch (err: any) {
      console.error('Patch plan failed:', err);

      if (err.message && (err.message.includes('Conflict') || err.message.includes('409'))) {
        setSaveStatus('conflict');
        setStatusMessage('Conflict: Plan was updated on server. Refreshing...');

        try {
          const latest = await api.getProject(project.id);
          const headV = latest.project?.headVersion || latest.headVersion || plan.version + 1;
          const headPlanData = await api.getPlanVersion(project.id, headV);
          if (headPlanData?.plan) {
            setPlan(headPlanData.plan);
            setStatusMessage(`Synchronized with v${headV}`);
            setTimeout(() => setSaveStatus('saved'), 2000);
          }
        } catch (fetchErr) {
          console.error('Failed to reload head version after conflict:', fetchErr);
        }
      } else {
        setSaveStatus('error');
        setStatusMessage(err.message || 'Failed to save');
      }
    }
  }, [project, plan.current, plan.draft, plan.version, commitDraft, setPlan]);

  useEffect(() => {
    if (!plan.draft) return;

    setSaveStatus('saving');
    setStatusMessage('Unsaved draft...');

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      syncDraftToServer();
    }, 450);

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
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 select-none text-xs">
      {/* Auto-Sync & Status Bar */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#0B0F17] border border-surfaceBorder text-[11px]">
        <span className="text-slate-400 font-medium">Auto-Sync Status</span>
        <div className="flex items-center space-x-1.5 font-mono">
          {saveStatus === 'saving' && (
            <>
              <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
              <span className="text-blue-400">{statusMessage || 'Saving...'}</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Synced (v{plan.version})</span>
            </>
          )}
          {saveStatus === 'conflict' && (
            <>
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span className="text-amber-400">{statusMessage}</span>
            </>
          )}
          {saveStatus === 'error' && (
            <>
              <AlertTriangle className="w-3 h-3 text-red-400" />
              <span className="text-red-400">{statusMessage}</span>
            </>
          )}
        </div>
      </div>

      {/* Layer Tabs / Selector Bar */}
      <div>
        <div className="flex items-center justify-between text-slate-300 font-semibold mb-2">
          <span className="flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span>Inspector Layers ({effectivePlan?.layers.length || 0})</span>
          </span>
          <div className="relative">
            <button
              onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-medium transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>Add Layer</span>
            </button>

            {isAddMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-[#0F141E] border border-surfaceBorder rounded-xl shadow-xl z-50 p-1 space-y-0.5 text-[11px]">
                <button
                  onClick={() => handleAddLayer('text')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 transition-colors flex items-center space-x-2"
                >
                  <Type className="w-3.5 h-3.5 text-sky-400" />
                  <span>Text Overlay</span>
                </button>
                <button
                  onClick={() => handleAddLayer('color')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 transition-colors flex items-center space-x-2"
                >
                  <Palette className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Color LUT Grade</span>
                </button>
                <button
                  onClick={() => handleAddLayer('subtitle')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 transition-colors flex items-center space-x-2"
                >
                  <Type className="w-3.5 h-3.5 text-amber-400" />
                  <span>Subtitles</span>
                </button>
                <button
                  onClick={() => handleAddLayer('music')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 transition-colors flex items-center space-x-2"
                >
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Background Music</span>
                </button>
                <button
                  onClick={() => handleAddLayer('speed')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 transition-colors flex items-center space-x-2"
                >
                  <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Speed Factor</span>
                </button>
                <button
                  onClick={() => handleAddLayer('intro')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 transition-colors flex items-center space-x-2"
                >
                  <Film className="w-3.5 h-3.5 text-purple-400" />
                  <span>Intro Title Card</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Horizontal Layer Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1.5">
          {effectivePlan?.layers.map((layer) => {
            const isSelected = layer.id === selectedLayerId;
            return (
              <button
                key={layer.id}
                onClick={() => selectLayer(layer.id)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border flex items-center space-x-1.5 shrink-0 transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                    : 'bg-[#0B0F17] hover:bg-slate-800 text-slate-300 border-surfaceBorder'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    layer.enabled ? 'bg-emerald-400' : 'bg-slate-600'
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
        <div className="bg-[#0B0F17] p-3.5 rounded-xl border border-surfaceBorder space-y-4">
          {/* Layer Header: Name, ID, Enable/Disable, Delete */}
          <div className="flex items-center justify-between pb-2 border-b border-surfaceBorder">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-slate-200 capitalize text-xs">
                {activeLayer.layer} Layer Properties
              </span>
              <span className="font-mono text-[10px] text-slate-500">({activeLayer.id})</span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  updateDraft((d) => {
                    const l = d.layers.find((lyr) => lyr.id === activeLayer.id);
                    if (l) l.enabled = !l.enabled;
                  });
                }}
                className="p-1 text-slate-400 hover:text-white transition-colors"
                title={activeLayer.enabled ? 'Disable layer' : 'Enable layer'}
              >
                {activeLayer.enabled ? (
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                )}
              </button>

              <button
                onClick={() => {
                  updateDraft((d) => {
                    d.layers = d.layers.filter((lyr) => lyr.id !== activeLayer.id);
                  });
                }}
                className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                title="Remove layer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 1. Color Layer Controls */}
          {activeLayer.layer === 'color' && (
            <div className="space-y-3.5">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1.5 font-medium">
                  LUT Preset
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {colorPresets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        updateDraft((d) => {
                          const c = d.layers.find((l) => l.id === activeLayer.id) as any;
                          if (c) c.params.preset = preset.id;
                        });
                      }}
                      className={`px-2 py-1.5 rounded-lg text-[10px] font-medium border text-center transition-all ${
                        activeLayer.params?.preset === preset.id
                          ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                          : 'bg-surface hover:bg-slate-800 text-slate-300 border-surfaceBorder'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Contrast</span>
                  <span className="font-mono text-slate-200">
                    {(activeLayer.params?.contrast ?? 1.0).toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.70"
                  max="1.50"
                  step="0.05"
                  value={activeLayer.params?.contrast ?? 1.0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateDraft((d) => {
                      const c = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (c) c.params.contrast = val;
                    });
                  }}
                  className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Saturation</span>
                  <span className="font-mono text-slate-200">
                    {(activeLayer.params?.saturation ?? 1.0).toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.00"
                  max="2.00"
                  step="0.05"
                  value={activeLayer.params?.saturation ?? 1.0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateDraft((d) => {
                      const c = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (c) c.params.saturation = val;
                    });
                  }}
                  className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Vignette Edge</span>
                  <span className="font-mono text-slate-200">
                    {(activeLayer.params?.vignette ?? 0.0).toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.00"
                  max="1.00"
                  step="0.05"
                  value={activeLayer.params?.vignette ?? 0.0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateDraft((d) => {
                      const c = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (c) c.params.vignette = val;
                    });
                  }}
                  className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Brightness</span>
                  <span className="font-mono text-slate-200">
                    {(activeLayer.params?.brightness ?? 0.0).toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="-0.50"
                  max="0.50"
                  step="0.05"
                  value={activeLayer.params?.brightness ?? 0.0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateDraft((d) => {
                      const c = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (c) c.params.brightness = val;
                    });
                  }}
                  className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* 2. Subtitle Layer Controls */}
          {activeLayer.layer === 'subtitle' && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Animation Style</span>
                <select
                  value={activeLayer.params?.style || 'word_pop'}
                  onChange={(e) => {
                    const style = e.target.value as any;
                    updateDraft((d) => {
                      const s = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (s) s.params.style = style;
                    });
                  }}
                  className="bg-surface border border-surfaceBorder rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
                >
                  <option value="word_pop">Word-Pop</option>
                  <option value="fade">Fade In</option>
                  <option value="bounce">Bounce</option>
                  <option value="karaoke">Karaoke</option>
                  <option value="minimal">Minimal</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Position</span>
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
                      className={`px-2 py-0.5 rounded text-[10px] capitalize transition-colors ${
                        (activeLayer.params?.position || 'bottom') === pos
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold'
                          : 'bg-surface text-slate-400 border border-surfaceBorder'
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Font Size</span>
                  <span className="font-mono text-slate-200">
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
                  className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="flex items-center justify-between bg-slate-900/60 p-2 rounded-lg border border-surfaceBorder">
                  <span className="text-slate-400 text-[10px]">Primary</span>
                  <input
                    type="color"
                    value={activeLayer.params?.primaryColor || '#FFFFFF'}
                    onChange={(e) => {
                      const col = e.target.value;
                      updateDraft((d) => {
                        const s = d.layers.find((l) => l.id === activeLayer.id) as any;
                        if (s) s.params.primaryColor = col;
                      });
                    }}
                    className="w-5 h-5 rounded cursor-pointer border border-white/20 bg-transparent"
                  />
                </div>

                <div className="flex items-center justify-between bg-slate-900/60 p-2 rounded-lg border border-surfaceBorder">
                  <span className="text-slate-400 text-[10px]">Highlight</span>
                  <input
                    type="color"
                    value={activeLayer.params?.highlightColor || '#FFD84D'}
                    onChange={(e) => {
                      const col = e.target.value;
                      updateDraft((d) => {
                        const s = d.layers.find((l) => l.id === activeLayer.id) as any;
                        if (s) s.params.highlightColor = col;
                      });
                    }}
                    className="w-5 h-5 rounded cursor-pointer border border-white/20 bg-transparent"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 3. Text Overlay Layer Controls */}
          {activeLayer.layer === 'text' && (
            <div className="space-y-3.5">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1 font-medium">
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
                  className="w-full bg-surface border border-surfaceBorder rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Animation</span>
                <select
                  value={activeLayer.params?.animation || 'fade'}
                  onChange={(e) => {
                    const anim = e.target.value as any;
                    updateDraft((d) => {
                      const t = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (t) t.params.animation = anim;
                    });
                  }}
                  className="bg-surface border border-surfaceBorder rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
                >
                  <option value="fade">Fade</option>
                  <option value="slide_up">Slide Up</option>
                  <option value="scale">Scale</option>
                  <option value="typewriter">Typewriter</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Font Size</span>
                  <span className="font-mono text-slate-200">
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
                  className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between bg-slate-900/60 p-2 rounded-lg border border-surfaceBorder">
                <span className="text-slate-400 text-[10px]">Text Color</span>
                <input
                  type="color"
                  value={activeLayer.params?.color || '#FFFFFF'}
                  onChange={(e) => {
                    const c = e.target.value;
                    updateDraft((d) => {
                      const t = d.layers.find((l) => l.id === activeLayer.id) as any;
                      if (t) t.params.color = c;
                    });
                  }}
                  className="w-5 h-5 rounded cursor-pointer border border-white/20 bg-transparent"
                />
              </div>
            </div>
          )}

          {/* 4. Music Layer Controls */}
          {activeLayer.layer === 'music' && (
            <div className="space-y-3.5">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1 font-medium">
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
                  className="w-full bg-surface border border-surfaceBorder rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="mus_calm_01">Calm Cinematic Ambient (96 BPM)</option>
                  <option value="mus_upbeat_01">Upbeat Creator Energy (128 BPM)</option>
                  <option value="mus_lofi_01">Lo-Fi Chill Hop (85 BPM)</option>
                  <option value="mus_acoustic_01">Acoustic Sunshine (110 BPM)</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-400 text-[11px] block">Speech Ducking</span>
                  <span className="text-[10px] text-slate-600">&gt;8 dB auto-attenuation</span>
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
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-surface text-slate-500 border border-surfaceBorder'
                  }`}
                >
                  {activeLayer.params?.duckUnderSpeech ? 'ACTIVE (-12 dB)' : 'DISABLED'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-400 text-[11px] block">Beat Synchronization</span>
                  <span className="text-[10px] text-slate-600">
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
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-surface text-slate-500 border border-surfaceBorder'
                  }`}
                >
                  {activeLayer.params?.beatSync ? 'ENABLED' : 'OFF'}
                </button>
              </div>

              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Music Volume</span>
                  <span className="font-mono text-slate-200">
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
                  className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                    <span>Fade In</span>
                    <span className="font-mono text-slate-200">
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
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                    <span>Fade Out</span>
                    <span className="font-mono text-slate-200">
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
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Audio Layer Controls */}
          {activeLayer.layer === 'audio' && (
            <div className="space-y-3.5">
              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Loudness Target (EBU R128)</span>
                  <span className="font-mono text-slate-200">
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
                  className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-400 text-[11px] block">Background Denoise</span>
                  <span className="text-[10px] text-slate-600">FFT audio filter (afftdn)</span>
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
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'bg-surface text-slate-500 border border-surfaceBorder'
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
                <span className="text-slate-400 text-[11px]">Cut Reason</span>
                <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 text-[10px] font-mono capitalize">
                  {activeLayer.params?.reason || 'silence'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-slate-900/60 p-2 rounded-lg border border-surfaceBorder">
                  <span className="text-slate-500 block text-[10px]">Start Cut</span>
                  <span className="font-mono text-slate-200">
                    {(activeLayer.range?.start || 0).toFixed(2)}s
                  </span>
                </div>
                <div className="bg-slate-900/60 p-2 rounded-lg border border-surfaceBorder">
                  <span className="text-slate-500 block text-[10px]">End Cut</span>
                  <span className="font-mono text-slate-200">
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
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Speed Multiplier</span>
                  <span className="font-mono text-slate-200 font-semibold">
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
                  className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Pitch Correction</span>
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
                  className="rounded accent-cyan-500"
                />
              </div>
            </div>
          )}

          {/* 7. Intro / Outro Layer Controls */}
          {(activeLayer.layer === 'intro' || activeLayer.layer === 'outro') && (
            <div className="space-y-3.5">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1 font-medium">
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
                  className="w-full bg-surface border border-surfaceBorder rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1 font-medium">
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
                  className="w-full bg-surface border border-surfaceBorder rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Duration</span>
                  <span className="font-mono text-slate-200">
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
                  className="w-full accent-purple-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-6 text-center text-slate-500 border border-dashed border-surfaceBorder rounded-xl">
          <p className="font-medium">No Layer Selected</p>
          <p className="text-[11px] mt-1 text-slate-600">
            Click any clip on the timeline or select a layer chip above to inspect its parameters.
          </p>
        </div>
      )}
    </div>
  );
};
