import React, { useState } from 'react';
import { Undo2, Redo2, Download, Film, Sparkles, ArrowLeft, Loader2, User } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../api/client';
import { ExportModal } from './ExportModal';
import { toast } from '../../stores/toastStore';

interface EditorHeaderProps {
  onBack: () => void;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({ onBack }) => {
  const { project, plan, undo, redo, preview, updateJob, setPreviewUrl } = useEditorStore();
  const { user } = useAuthStore();
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);

  const canUndo = plan.cursor > 0;
  const canRedo = plan.cursor < plan.history.length - 1;

  const handleUndo = () => {
    if (canUndo) {
      undo();
      toast.info('Reverted to previous plan version', 'Undo');
    }
  };

  const handleRedo = () => {
    if (canRedo) {
      redo();
      toast.info('Restored next plan version', 'Redo');
    }
  };

  React.useEffect(() => {
    const handleUndoRedoKeys = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleUndoRedoKeys);
    return () => window.removeEventListener('keydown', handleUndoRedoKeys);
  }, [canUndo, canRedo, undo, redo]);

  const handlePreviewRender = async () => {
    if (!project || isRenderingPreview) return;
    setIsRenderingPreview(true);
    toast.info('Rendering timeline preview proxy...', 'Preview Rendering');
    try {
      const res = await api.enqueuePreview(project.id, {
        planVersion: plan.version,
      });

      api.subscribeToJobEvents(res.jobId, (event) => {
        updateJob(res.jobId, {
          percent: event.percent,
          state: event.state,
        });

        const isDone = event.state === 'done' || event.state === 'completed';
        const isFailed = event.state === 'failed';

        if (isDone) {
          setIsRenderingPreview(false);
          toast.success(`Preview proxy rendered for v${plan.version}`, 'Timeline Preview Ready');
          api.getJobDownloadUrl(res.jobId).then((d) => {
            setPreviewUrl(d.url, plan.version, true);
          });
        } else if (isFailed) {
          setIsRenderingPreview(false);
          toast.error('Timeline preview render failed', 'Preview Error');
        }
      });
    } catch (err: any) {
      console.error('Preview render trigger failed:', err);
      setIsRenderingPreview(false);
      toast.error(err?.message || 'Preview render trigger failed', 'Preview Error');
    }
  };

  return (
    <>
      <header className="h-14 border-b border-[#393B3F] bg-[#18191B] px-3 sm:px-4 flex items-center justify-between select-none font-sans gap-2">
        {/* Left section: Back button & Title */}
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 hover:bg-[#2A2C2F] rounded-lg text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors shrink-0"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-[#393B3F] shrink-0" />

          <div className="flex items-center space-x-1.5 sm:space-x-2 min-w-0">
            <Film className="w-4 h-4 text-[#E3B5BE] shrink-0" />
            <h1 className="text-xs sm:text-sm font-semibold text-[#FFF5F5] truncate max-w-[90px] xs:max-w-[130px] sm:max-w-[180px] md:max-w-xs">
              {project?.title || 'Video Studio'}
            </h1>
            <span className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full bg-[#2A2C2F] text-[#F7D7D1] font-mono border border-[#393B3F] shrink-0">
              v{plan.version}
            </span>
            {preview.stale && (
              <span className="hidden md:inline-block text-[10px] px-1.5 py-0.5 rounded bg-[#2A2C2F] text-[#F7D7D1] border border-[#E3B5BE]/30 font-medium shrink-0">
                Modified
              </span>
            )}
          </div>
        </div>

        {/* Center section: Undo / Redo */}
        <div className="flex items-center space-x-1 bg-[#121314] p-0.5 sm:p-1 rounded-lg border border-[#393B3F] shrink-0">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="p-1 sm:p-1.5 rounded hover:bg-[#2A2C2F] text-[#FFF5F5] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="p-1 sm:p-1.5 rounded hover:bg-[#2A2C2F] text-[#FFF5F5] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>

        {/* Right section: Render Preview & Export Actions */}
        <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
          <button
            onClick={handlePreviewRender}
            disabled={isRenderingPreview}
            className="flex items-center space-x-1 sm:space-x-1.5 bg-[#222326] hover:bg-[#2A2C2F] text-[#FFF5F5] px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border border-[#393B3F] disabled:opacity-50"
            title="Render 480p Preview with burned effects"
          >
            {isRenderingPreview ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E3B5BE]" />
                <span className="hidden sm:inline">Rendering...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-[#E3B5BE]" />
                <span className="hidden sm:inline">Render 480p Preview</span>
                <span className="sm:hidden text-[10px]">480p</span>
              </>
            )}
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center space-x-1 sm:space-x-1.5 bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold uppercase tracking-wider px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs shadow-sm transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export Final</span>
            <span className="sm:hidden">Export</span>
          </button>

          {user && (
            <div className="hidden md:flex items-center space-x-1.5 pl-2.5 border-l border-[#393B3F]">
              <div className="w-6 h-6 rounded-full bg-[#2A2C2F] text-[#E3B5BE] text-[10px] font-bold flex items-center justify-center border border-[#E3B5BE]/30">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-[10px] font-mono uppercase font-bold px-1.5 py-0.5 rounded bg-[#2A2C2F] text-[#F7D7D1] border border-[#393B3F]">
                {user.tier}
              </span>
            </div>
          )}
        </div>
      </header>

      <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} />
    </>
  );
};
