import React, { useEffect, useState } from 'react';
import {
  X,
  History,
  RotateCcw,
  RotateCw,
  CheckCircle2,
  Layers,
  Clock,
  Sparkles,
  AlertCircle,
  Loader2,
  Bot,
  User,
  Sliders,
  Scissors,
  Palette,
  Type,
  Music,
} from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { api } from '../../api/client';
import { toast } from '../../stores/toastStore';

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PlanVersionEntry {
  version: number;
  parentVersion: number | null;
  prompt: string;
  model: string;
  createdAt: string;
  layersCount: number;
  layers: Array<{ id: string; layer: string; enabled: boolean }>;
  isCurrent: boolean;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({ isOpen, onClose }) => {
  const { project, plan, setPlan, preview, setPreviewUrl } = useEditorStore();
  const [versions, setVersions] = useState<PlanVersionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [revertingVersion, setRevertingVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchVersions = async () => {
    if (!project?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPlanVersions(project.id);
      const data = (res as any)?.data || res;
      setVersions(data.versions || []);
    } catch (err: any) {
      console.error('[VersionHistoryModal] Failed to fetch versions:', err);
      setError(err?.message || 'Failed to load version history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && project?.id) {
      fetchVersions();
    }
  }, [isOpen, project?.id]);

  if (!isOpen) return null;

  const handleRevert = async (targetVersion: number) => {
    if (!project?.id || revertingVersion !== null) return;
    setRevertingVersion(targetVersion);
    try {
      const res = await api.revertPlan(project.id, targetVersion);
      const newPlan = res?.data?.plan || (res as any)?.plan;
      if (newPlan) {
        setPlan(newPlan);

        // Seamlessly restore preview URL if known for target version; otherwise reset to clean base proxy
        if (preview.versionUrlMap?.[targetVersion]) {
          setPreviewUrl(preview.versionUrlMap[targetVersion], newPlan.version, true);
        } else if (preview.baseProxyUrl) {
          setPreviewUrl(preview.baseProxyUrl, newPlan.version, false);
        }

        toast.success(
          `Reverted sequence to snapshot of v${targetVersion} (now v${newPlan.version})`,
          'Version Restored'
        );
        await fetchVersions();
      }
    } catch (err: any) {
      console.error('[VersionHistoryModal] Revert failed:', err);
      toast.error(err?.message || 'Failed to revert version', 'Revert Failed');
    } finally {
      setRevertingVersion(null);
    }
  };

  const getLayerIcon = (layerType: string) => {
    switch (layerType) {
      case 'cut':
        return <Scissors className="w-2.5 h-2.5 text-red-400" />;
      case 'subtitle':
        return <Type className="w-2.5 h-2.5 text-[#E3B5BE]" />;
      case 'audio':
        return <Sliders className="w-2.5 h-2.5 text-emerald-400" />;
      case 'music':
        return <Music className="w-2.5 h-2.5 text-blue-400" />;
      case 'color':
        return <Palette className="w-2.5 h-2.5 text-[#F7D7D1]" />;
      default:
        return <Layers className="w-2.5 h-2.5 text-[#FFF5F5]/60" />;
    }
  };

  const formatTimestamp = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Recently';
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Recently';
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-history-title"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in"
    >
      <div className="bg-[#1C1D1F] border border-[#393B3F] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#393B3F] flex items-center justify-between bg-[#18191B]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-center text-[#E3B5BE]">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 id="version-history-title" className="text-sm font-semibold text-[#FFF5F5] flex items-center gap-2">
                <span>Sequence Version History</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#2A2C2F] text-[#F7D7D1] border border-[#393B3F]">
                  v{plan.version} active
                </span>
              </h3>
              <p className="text-[11px] text-[#FFF5F5]/50">
                Complete audit trail of all AI Director actions, user adjustments, and snapshots
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={fetchVersions}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-[#2A2C2F] text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors"
              title="Refresh version list"
            >
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#E3B5BE]' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#2A2C2F] text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors"
              title="Close history modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1 custom-scrollbar">
          {loading && versions.length === 0 && (
            <div className="py-12 text-center text-[#FFF5F5]/50 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#E3B5BE]" />
              <p className="text-xs font-mono">Loading plan version snapshots...</p>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-950/30 border border-red-800/40 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && versions.length === 0 && !error && (
            <div className="py-12 text-center text-[#FFF5F5]/40 space-y-2">
              <History className="w-8 h-8 mx-auto opacity-40 text-[#E3B5BE]" />
              <p className="text-xs font-medium text-[#FFF5F5]/80">No historical versions recorded yet</p>
              <p className="text-[11px] max-w-xs mx-auto">
                Edits submitted through the AI Director or timeline operations will generate versioned checkpoints here.
              </p>
            </div>
          )}

          {versions.map((ver) => {
            const isCurrentHead = ver.version === plan.version;
            const isRevert = ver.prompt.toLowerCase().includes('revert');

            return (
              <div
                key={ver.version}
                className={`p-3.5 rounded-xl border transition-all flex flex-col gap-2.5 ${
                  isCurrentHead
                    ? 'bg-[#E3B5BE]/10 border-[#E3B5BE] shadow-md ring-1 ring-[#E3B5BE]/30'
                    : 'bg-[#18191B] border-[#393B3F] hover:border-[#FFF5F5]/30'
                }`}
              >
                {/* Header row: Version pill, Model, Timestamp, and Revert/Active Action */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md ${
                        isCurrentHead
                          ? 'bg-[#E3B5BE] text-[#18191B]'
                          : 'bg-[#2A2C2F] text-[#F7D7D1] border border-[#393B3F]'
                      }`}
                    >
                      v{ver.version}
                    </span>

                    {isCurrentHead && (
                      <span className="flex items-center gap-1 text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Current Sequence</span>
                      </span>
                    )}

                    {isRevert && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        Revert Snapshot
                      </span>
                    )}

                    <span className="text-[10px] font-mono text-[#FFF5F5]/40 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {formatTimestamp(ver.createdAt)}
                    </span>
                  </div>

                  {/* Right: Revert Action Button */}
                  <div>
                    {isCurrentHead ? (
                      <span className="text-[11px] font-mono text-[#E3B5BE] font-semibold flex items-center gap-1 px-2 py-1">
                        <Sparkles className="w-3 h-3" />
                        <span>Active Head</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRevert(ver.version)}
                        disabled={revertingVersion !== null}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#2A2C2F] hover:bg-[#E3B5BE] text-[#FFF5F5] hover:text-[#18191B] text-xs font-semibold border border-[#393B3F] hover:border-[#E3B5BE] transition-all disabled:opacity-50"
                        title={`Restore sequence to snapshot of v${ver.version}`}
                      >
                        {revertingVersion === ver.version ? (
                          <Loader2 className="w-3 h-3 animate-spin text-[#E3B5BE]" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        <span>Restore this cut</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Prompt / Edit Summary */}
                <p className="text-xs text-[#FFF5F5]/90 font-medium leading-relaxed">
                  {ver.prompt}
                </p>

                {/* Footer: Model / Author and Layer Tags */}
                <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px] text-[#FFF5F5]/60 flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 font-mono">
                    {ver.model.includes('gemini') ? (
                      <Bot className="w-3 h-3 text-[#E3B5BE]" />
                    ) : ver.model.includes('manual') ? (
                      <User className="w-3 h-3 text-[#F7D7D1]" />
                    ) : (
                      <Sparkles className="w-3 h-3 text-[#E3B5BE]" />
                    )}
                    <span className="opacity-80">{ver.model}</span>
                    {ver.parentVersion !== null && (
                      <span className="text-[#FFF5F5]/40">· branched from v{ver.parentVersion}</span>
                    )}
                  </div>

                  {/* Layers Count & Badges */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[#FFF5F5]/40 text-[9px]">
                      {ver.layersCount} {ver.layersCount === 1 ? 'layer' : 'layers'}:
                    </span>
                    {ver.layers.map((l) => (
                      <span
                        key={l.id}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono border ${
                          l.enabled
                            ? 'bg-[#222326] border-[#393B3F] text-[#FFF5F5]/80'
                            : 'bg-white/5 border-transparent text-[#FFF5F5]/30 line-through'
                        }`}
                        title={`${l.layer} layer (${l.enabled ? 'enabled' : 'disabled'})`}
                      >
                        {getLayerIcon(l.layer)}
                        <span>{l.layer}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#18191B] border-t border-[#393B3F] flex items-center justify-between text-xs text-[#FFF5F5]/60">
          <span className="text-[11px] font-mono">
            {versions.length} recorded {versions.length === 1 ? 'checkpoint' : 'checkpoints'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#2A2C2F] hover:bg-[#34373B] text-xs text-[#FFF5F5] font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
