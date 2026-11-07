import React, { useState } from 'react';
import { Undo2, Redo2, Download, Film, Sparkles, ArrowLeft, Loader2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { api } from '../../api/client';
import { ExportModal } from './ExportModal';

interface EditorHeaderProps {
  onBack: () => void;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({ onBack }) => {
  const { project, plan, undo, redo, preview, updateJob, setPreviewUrl } = useEditorStore();
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);

  const canUndo = plan.cursor > 0;
  const canRedo = plan.cursor < plan.history.length - 1;

  React.useEffect(() => {
    const handleUndoRedoKeys = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) redo();
        } else {
          if (canUndo) undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (canRedo) redo();
      }
    };

    window.addEventListener('keydown', handleUndoRedoKeys);
    return () => window.removeEventListener('keydown', handleUndoRedoKeys);
  }, [canUndo, canRedo, undo, redo]);

  const handlePreviewRender = async () => {
    if (!project || isRenderingPreview) return;
    setIsRenderingPreview(true);
    try {
      const res = await api.enqueuePreview(project.id, {
        planVersion: plan.version,
      });

      api.subscribeToJobEvents(res.jobId, (event) => {
        updateJob(res.jobId, {
          percent: event.percent,
          state: event.state,
        });

        if (event.state === 'done') {
          setIsRenderingPreview(false);
          api.getJobDownloadUrl(res.jobId).then((d) => {
            setPreviewUrl(d.url, plan.version);
          });
        } else if (event.state === 'failed') {
          setIsRenderingPreview(false);
        }
      });
    } catch (err) {
      console.error('Preview render trigger failed:', err);
      setIsRenderingPreview(false);
    }
  };

  return (
    <>
      <header className="h-14 border-b border-surfaceBorder bg-surface px-4 flex items-center justify-between select-none">
        {/* Left section: Back button & Title */}
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-surfaceBorder" />

          <div className="flex items-center space-x-2">
            <Film className="w-4 h-4 text-blue-500" />
            <h1 className="text-sm font-semibold text-slate-100">
              {project?.title || 'Video Editor'}
            </h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
              v{plan.version}
            </span>
            {preview.stale && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                Plan modified
              </span>
            )}
          </div>
        </div>

        {/* Center section: Undo / Redo */}
        <div className="flex items-center space-x-1 bg-[#0B0F17] p-1 rounded-lg border border-surfaceBorder">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        {/* Right section: Render Preview & Export Actions */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handlePreviewRender}
            disabled={isRenderingPreview}
            className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border border-surfaceBorder disabled:opacity-50"
          >
            {isRenderingPreview ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                <span>Rendering Preview...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                <span>Render 480p Preview</span>
              </>
            )}
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-md shadow-blue-600/20 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Final</span>
          </button>
        </div>
      </header>

      <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} />
    </>
  );
};
