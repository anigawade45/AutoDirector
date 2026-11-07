import React, { useState } from 'react';
import { X, Settings2, Check, Loader2 } from 'lucide-react';
import { api } from '../../api/client';

interface EditProjectModalProps {
  project: {
    publicId: string;
    title: string;
    status: string;
    settings?: {
      aspect?: '16:9' | '9:16' | '1:1' | '4:5';
      fps?: number;
      width?: number;
      height?: number;
      language?: string;
    };
  };
  onClose: () => void;
  onUpdated: () => void;
}

export const EditProjectModal: React.FC<EditProjectModalProps> = ({
  project,
  onClose,
  onUpdated,
}) => {
  const [title, setTitle] = useState(project.title);
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1' | '4:5'>(
    project.settings?.aspect || '16:9'
  );
  const [fps, setFps] = useState<number>(project.settings?.fps || 30);
  const [language, setLanguage] = useState<string>(project.settings?.language || 'en');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const aspectResolutions: Record<
    '16:9' | '9:16' | '1:1' | '4:5',
    { width: number; height: number; label: string }
  > = {
    '16:9': { width: 1920, height: 1080, label: '16:9 Landscape (YouTube)' },
    '9:16': { width: 1080, height: 1920, label: '9:16 Vertical (TikTok/Reels)' },
    '1:1': { width: 1080, height: 1080, label: '1:1 Square (Instagram Feed)' },
    '4:5': { width: 1080, height: 1350, label: '4:5 Portrait (Social Post)' },
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Project title cannot be empty');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);

    try {
      const resDims = aspectResolutions[aspect];
      await api.updateProject(project.publicId, {
        title: title.trim(),
        settings: {
          aspect,
          fps,
          width: resDims.width,
          height: resDims.height,
          language,
        },
      });

      onUpdated();
      onClose();
    } catch (err: any) {
      console.error('Failed to update project:', err);
      setErrorMsg(err.message || 'Failed to update project settings');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-surfaceBorder rounded-2xl max-w-lg w-full p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={onClose}
          disabled={isSaving}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors p-1"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
            <Settings2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">Project Settings & Rename</h3>
            <p className="text-xs text-slate-400 font-mono">{project.publicId}</p>
          </div>
        </div>

        {errorMsg && (
          <div className="my-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5 mt-4">
          {/* Project Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Project Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSaving}
              placeholder="e.g. Vacation Highlights 2026"
              className="w-full bg-slate-900 border border-surfaceBorder rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
              autoFocus
            />
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Aspect Ratio & Resolution
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(aspectResolutions) as Array<keyof typeof aspectResolutions>).map(
                (asp) => (
                  <button
                    type="button"
                    key={asp}
                    onClick={() => setAspect(asp)}
                    className={`text-left p-2.5 rounded-xl border text-xs transition-all flex items-center justify-between ${
                      aspect === asp
                        ? 'bg-blue-600/15 border-blue-500 text-blue-300 shadow-sm shadow-blue-500/10'
                        : 'bg-slate-900/60 border-surfaceBorder text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{asp}</div>
                      <div className="text-[10px] text-slate-500">
                        {aspectResolutions[asp].label.split('(')[1]?.replace(')', '') || ''}
                      </div>
                    </div>
                    {aspect === asp && <Check className="w-4 h-4 text-blue-400 shrink-0" />}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Frame Rate & Language */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Frame Rate (FPS)
              </label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                disabled={isSaving}
                className="w-full bg-slate-900 border border-surfaceBorder rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value={24}>24 fps (Cinematic)</option>
                <option value={25}>25 fps (PAL / Broadcast)</option>
                <option value={30}>30 fps (Standard Web)</option>
                <option value={60}>60 fps (Smooth / Gaming)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Primary Audio Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isSaving}
                className="w-full bg-slate-900 border border-surfaceBorder rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value="en">English (en)</option>
                <option value="es">Spanish (es)</option>
                <option value="fr">French (fr)</option>
                <option value="de">German (de)</option>
                <option value="hi">Hindi (hi)</option>
                <option value="ja">Japanese (ja)</option>
              </select>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="pt-3 border-t border-surfaceBorder flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all flex items-center space-x-2 shadow-lg shadow-blue-600/20 disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
