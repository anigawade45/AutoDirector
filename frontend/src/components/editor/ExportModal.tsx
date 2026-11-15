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
import { toast } from '../../stores/toastStore';

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

    const profileLabel =
      profile === 'final_4k' ? '4K UHD' : profile === 'preview_480p' ? '480p Draft' : '1080p FHD';
    toast.info(`Export queued: ${profileLabel}`, 'Render Enqueued');

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
            toast.success(`Export complete for "${project.title}"!`, 'Render Ready');
            api.getJobDownloadUrl(exportJob.jobId).then((res) => {
              setDownloadUrl(res.url);
            });
          } else if (event.state === 'failed') {
            setStatus('error');
            const errMsg = event.error || 'Export rendering failed';
            setErrorMessage(errMsg);
            toast.error(errMsg, 'Render Failed');
          }
        },
        (err) => {
          console.error('SSE Error during export:', err);
        }
      );
    } catch (err: any) {
      console.error('Export initiation failed:', err);
      setStatus('error');
      const errMsg = err.message || 'Could not initiate export job';
      setErrorMessage(errMsg);
      toast.error(errMsg, 'Export Error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto animate-fade-in select-none font-sans">
      <div className="bg-[#222326] border border-[#393B3F] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto my-auto shadow-2xl text-[#FFF5F5]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#393B3F] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2A2C2F] border border-[#E3B5BE]/30 flex items-center justify-center text-[#E3B5BE]">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#FFF5F5]">Export Final Video</h3>
              <p className="text-[11px] text-[#FFF5F5]/60 font-mono">
                Plan version v{plan.version} • {project.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#2A2C2F] text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {status === 'idle' && (
            <>
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-2">
                  Select Output Resolution
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {/* 1080p */}
                  <div
                    onClick={() => setProfile('final_1080p')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      profile === 'final_1080p'
                        ? 'bg-[#E3B5BE]/15 border-[#E3B5BE] shadow-sm'
                        : 'bg-[#18191B] border-[#393B3F] hover:border-[#484949]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-xs text-[#FFF5F5]">1080p FHD</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2A2C2F] text-[#F7D7D1] font-mono border border-[#393B3F]">
                        Standard
                      </span>
                    </div>
                    <p className="text-[11px] text-[#FFF5F5]/70 font-mono">1920x1080 @ 30fps</p>
                    <p className="text-[10px] text-[#FFF5F5]/50 mt-1">High quality, fast render</p>
                  </div>

                  {/* 4K */}
                  <div
                    onClick={() => setProfile('final_4k')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      profile === 'final_4k'
                        ? 'bg-[#E3B5BE]/15 border-[#E3B5BE] shadow-sm'
                        : 'bg-[#18191B] border-[#393B3F] hover:border-[#484949]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-xs text-[#FFF5F5]">4K UHD</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2A2C2F] text-[#E3B5BE] font-mono border border-[#393B3F]">
                        Master
                      </span>
                    </div>
                    <p className="text-[11px] text-[#FFF5F5]/70 font-mono">3840x2160 @ 30fps</p>
                    <p className="text-[10px] text-[#FFF5F5]/50 mt-1">Cinema grade master</p>
                  </div>

                  {/* 480p Preview */}
                  <div
                    onClick={() => setProfile('preview_480p')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      profile === 'preview_480p'
                        ? 'bg-[#E3B5BE]/15 border-[#E3B5BE] shadow-sm'
                        : 'bg-[#18191B] border-[#393B3F] hover:border-[#484949]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-xs text-[#FFF5F5]">480p</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2A2C2F] text-[#FFF5F5]/60 font-mono border border-[#393B3F]">
                        Draft
                      </span>
                    </div>
                    <p className="text-[11px] text-[#FFF5F5]/70 font-mono">854x480 @ 30fps</p>
                    <p className="text-[10px] text-[#FFF5F5]/50 mt-1">Instant web proxy</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Rendering Progress View */}
          {status === 'rendering' && (
            <div className="py-6 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#FFF5F5] font-medium flex items-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#E3B5BE]" />
                  <span>5-Pass FFmpeg Encoding in progress...</span>
                </span>
                <span className="font-mono text-[#F7D7D1] font-bold">{progress}%</span>
              </div>
              <div className="w-full bg-[#18191B] rounded-full h-2 overflow-hidden border border-[#393B3F]">
                <div
                  className="bg-[#E3B5BE] h-full transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Completed View */}
          {status === 'completed' && (
            <div className="py-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#2A2C2F] border border-[#E3B5BE]/40 flex items-center justify-center mx-auto text-[#E3B5BE]">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[#FFF5F5]">Export Complete</h4>
                <p className="text-xs text-[#FFF5F5]/60 mt-0.5">
                  Your video master has been compiled and is ready for download.
                </p>
              </div>

              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download={`${project.title.replace(/\s+/g, '_')}_v${plan.version}.mp4`}
                  className="inline-flex items-center justify-center space-x-2 px-6 py-2.5 rounded-lg bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold uppercase tracking-wider text-xs shadow-sm transition-all"
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
              <div className="w-12 h-12 rounded-full bg-red-950/40 border border-red-800/50 flex items-center justify-center mx-auto text-red-400">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-semibold text-[#FFF5F5]">Export Failed</h4>
              <p className="text-xs text-red-300 max-w-sm mx-auto">{errorMessage}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[#18191B] border-t border-[#393B3F] flex items-center justify-end space-x-2.5">
          {status === 'idle' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-[#393B3F] hover:bg-[#2A2C2F] text-xs text-[#FFF5F5]/70 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStartExport}
                className="flex items-center space-x-1.5 px-5 py-2 rounded-lg bg-[#E3B5BE] hover:bg-[#F7D7D1] text-xs font-bold uppercase tracking-wider text-[#18191B] shadow-sm transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Start Export</span>
              </button>
            </>
          )}

          {status === 'rendering' && (
            <button
              disabled
              className="px-4 py-2 rounded-lg bg-[#2A2C2F] text-xs text-[#FFF5F5]/40 cursor-not-allowed font-mono"
            >
              Exporting in background...
            </button>
          )}

          {(status === 'completed' || status === 'error') && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#2A2C2F] hover:bg-[#34373B] text-xs text-[#FFF5F5] transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
