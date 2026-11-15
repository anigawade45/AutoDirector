import React, { useState } from 'react';
import { X, Settings2, Check, Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { toast } from '../../stores/toastStore';

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
      toast.warning('Project title cannot be empty', 'Validation Warning');
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

      toast.success(`Project settings saved: ${title.trim()}`, 'Project Updated');
      onUpdated();
      onClose();
    } catch (err: any) {
      console.error('Failed to update project:', err);
      setErrorMsg(err.message || 'Failed to update project settings');
      toast.error(err.message || 'Failed to update project settings', 'Update Failed');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto font-sans">
      <div className="bg-[#222326] border border-[#393B3F] rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative my-auto animate-in fade-in zoom-in-95 duration-150 text-[#FFF5F5]">
        <button
          onClick={onClose}
          disabled={isSaving}
          className="absolute top-4 right-4 text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors p-1"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-[#2A2C2F] border border-[#E3B5BE]/30 text-[#E3B5BE] flex items-center justify-center">
            <Settings2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#FFF5F5]">Project Settings & Sequence</h3>
            <p className="text-xs text-[#FFF5F5]/50 font-mono">{project.publicId}</p>
          </div>
        </div>

        {errorMsg && (
          <div className="my-3 p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-red-300 text-xs">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5 mt-4">
          {/* Project Title */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
              Project Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSaving}
              placeholder="e.g. Vacation Highlights 2026"
              className="w-full bg-[#18191B] border border-[#393B3F] rounded-xl px-3.5 py-2.5 text-xs text-[#FFF5F5] placeholder-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE] transition-colors"
              autoFocus
            />
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
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
                        ? 'bg-[#E3B5BE]/15 border-[#E3B5BE] text-[#F7D7D1] shadow-sm'
                        : 'bg-[#18191B] border-[#393B3F] text-[#FFF5F5]/70 hover:border-[#484949]'
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{asp}</div>
                      <div className="text-[10px] text-[#FFF5F5]/50 font-mono">
                        {aspectResolutions[asp].label.split('(')[1]?.replace(')', '') || ''}
                      </div>
                    </div>
                    {aspect === asp && <Check className="w-4 h-4 text-[#E3B5BE] shrink-0" />}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Frame Rate & Language */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
                Frame Rate (FPS)
              </label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                disabled={isSaving}
                className="w-full bg-[#18191B] border border-[#393B3F] rounded-xl px-3 py-2 text-xs text-[#FFF5F5] focus:outline-none focus:border-[#E3B5BE] transition-colors"
              >
                <option value={24}>24 fps (Cinematic)</option>
                <option value={25}>25 fps (PAL / Broadcast)</option>
                <option value={30}>30 fps (Standard Web)</option>
                <option value={60}>60 fps (Smooth / Gaming)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
                Primary Audio Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isSaving}
                className="w-full bg-[#18191B] border border-[#393B3F] rounded-xl px-3 py-2 text-xs text-[#FFF5F5] focus:outline-none focus:border-[#E3B5BE] transition-colors"
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
          <div className="pt-3 border-t border-[#393B3F] flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-[#FFF5F5]/60 hover:text-[#FFF5F5] hover:bg-[#2A2C2F] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] transition-all flex items-center space-x-2 shadow-sm disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#18191B]" />
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
