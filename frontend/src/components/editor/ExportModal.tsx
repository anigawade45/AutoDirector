import React, { useState } from 'react';
import {
  X,
  Download,
  Film,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Settings,
  HardDrive,
} from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { api } from '../../api/client';
import { RenderProfile } from '@ai-video/shared';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const { project, plan, updateJob } = useEditorStore();
  const [profile, setProfile] = useState<RenderProfile>('final_1080p');
  const [status, setStatus] = useState<'idle' | 'rendering' | 'completed' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  if (!isOpen || !project) return null;

  const handleStartExport = async () => {
    setStatus('rendering');
    setProgress(0);
    setDownloadUrl(null);
    setErrorMessage(null);

    try {
      const exportJob = await api.enqueueExport(project.id, {
        planVersion: plan.version,
        profile,
      });

      setJobId(exportJob.jobId);

      const unsubscribe = api.subscribeToJobEvents(
        exportJob.jobId,
        (event) => {
          if (typeof event.percent === 'number') {
            setProgress(event.percent);
          }
          updateJob(exportJob.jobId, {
            percent: event.percent || 0,
            state: event.state,
          });

          if (event.state === 'done') {
            setStatus('completed');
            setProgress(100);
            api.getJobDownloadUrl(exportJob.jobId).then((res) => {
              setDownloadUrl(res.url);
            });
          } else if (event.state === 'failed') {
            setStatus('error');
            setErrorMessage(event.error || 'Export rendering failed');
          }
        },
        (err) => {
          console.error('SSE Error during export:', err);
        }
      );
    } catch (err: any) {
      console.error('Export initiation failed:', err);
      setStatus('error');
      setErrorMessage(err.message || 'Could not initiate export job');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in select-none">
      <div className="bg-[#0F141F] border border-surfaceBorder rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-surfaceBorder flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Export Final Video</h3>
              <p className="text-[11px] text-slate-400">
                Plan version v{plan.version} • {project.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {status === 'idle' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Select Output Resolution
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {/* 1080p */}
                  <div
                    onClick={() => setProfile('final_1080p')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      profile === 'final_1080p'
                        ? 'bg-blue-600/15 border-blue-500 shadow-md shadow-blue-500/10'
                        : 'bg-slate-900/60 border-surfaceBorder hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-xs text-slate-200">1080p FHD</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                        Default
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">1920x1080 @ 30fps</p>
                    <p className="text-[10px] text-slate-500 mt-1">High quality, fast render</p>
                  </div>

                  {/* 4K */}
                  <div
                    onClick={() => setProfile('final_4k')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      profile === 'final_4k'
                        ? 'bg-blue-600/15 border-blue-500 shadow-md shadow-blue-500/10'
                        : 'bg-slate-900/60 border-surfaceBorder hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-xs text-slate-200">4K UHD</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">
                        Ultra
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">3840x2160 @ 30fps</p>
                    <p className="text-[10px] text-slate-500 mt-1">Cinema grade master</p>
                  </div>

                  {/* 480p Preview */}
                  <div
                    onClick={() => setProfile('preview_480p')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      profile === 'preview_480p'
                        ? 'bg-blue-600/15 border-blue-500 shadow-md shadow-blue-500/10'
                        : 'bg-slate-900/60 border-surfaceBorder hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-xs text-slate-200">480p SD</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                        Draft
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">854x480 @ 30fps</p>
                    <p className="text-[10px] text-slate-500 mt-1">Quick web share</p>
                  </div>
                </div>
              </div>

              {/* Composition summary */}
              <div className="p-3.5 rounded-xl bg-slate-900/40 border border-surfaceBorder text-xs space-y-1.5">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Format:</span>
                  <span className="font-mono text-slate-200">MP4 (H.264 / AAC)</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Duration:</span>
                  <span className="font-mono text-slate-200">
                    {Math.round(project.durationSec || 60)}s
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Active Edit Layers:</span>
                  <span className="font-mono text-slate-200">
                    {plan.current?.layers.length || 0} layers
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Audio Spec:</span>
                  <span className="font-mono text-slate-200">EBU R128 (-16 LUFS, 44.1kHz)</span>
                </div>
              </div>
            </>
          )}

          {/* Rendering Progress View */}
          {status === 'rendering' && (
            <div className="py-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-blue-600/15 border border-blue-500/30 flex items-center justify-center mx-auto text-blue-400">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-200">
                  Rendering Final Composition...
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  FFmpeg is executing cuts, color filters, and burning subtitles
                </p>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 font-mono px-1">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
            </div>
          )}

          {/* Completed View */}
          {status === 'completed' && (
            <div className="py-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-600/15 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
                <CheckCircle2 className="w-6 h-6" />
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-100">Export Complete!</h4>
                <p className="text-xs text-slate-400 mt-1">
                  Your master MP4 video has been compiled and is ready for download
                </p>
              </div>

              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download={`${project.title.replace(/\s+/g, '_')}_v${plan.version}.mp4`}
                  className="inline-flex items-center justify-center space-x-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-lg shadow-blue-600/25 transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>Download MP4 Video</span>
                </a>
              )}
            </div>
          )}

          {/* Error View */}
          {status === 'error' && (
            <div className="py-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-red-600/15 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-semibold text-slate-100">Export Failed</h4>
              <p className="text-xs text-red-400 max-w-sm mx-auto">{errorMessage}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-900/60 border-t border-surfaceBorder flex items-center justify-end space-x-2.5">
          {status === 'idle' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-surfaceBorder hover:bg-slate-800 text-xs text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStartExport}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white shadow-md shadow-blue-600/20 transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Start Export</span>
              </button>
            </>
          )}

          {status === 'rendering' && (
            <button
              disabled
              className="px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-500 cursor-not-allowed"
            >
              Exporting in background...
            </button>
          )}

          {(status === 'completed' || status === 'error') && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
