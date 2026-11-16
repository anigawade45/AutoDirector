import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  itemName?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  itemName,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = true,
  isLoading = false,
  onConfirm,
  onClose,
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Focus trap / keyboard accessibility
  useEffect(() => {
    if (!isOpen) return;

    // Focus cancel button on open for safe default
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#18191B]/80 backdrop-blur-sm animate-in fade-in duration-150"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onClose();
        }
      }}
    >
      <div className="bg-[#222326] border border-[#393B3F] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 border-b border-[#393B3F] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                isDestructive
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  : 'bg-[#2A2C2F] border-[#E3B5BE]/30 text-[#E3B5BE]'
              }`}
            >
              {isDestructive ? (
                <Trash2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
            </div>
            <h2
              id="confirm-dialog-title"
              className="text-base font-bold text-[#FFF5F5] tracking-tight"
            >
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-1 rounded-lg text-[#FFF5F5]/40 hover:text-[#FFF5F5] hover:bg-[#2A2C2F] transition-colors disabled:opacity-40"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-3">
          <p id="confirm-dialog-desc" className="text-sm text-[#FFF5F5]/80 leading-relaxed">
            {description}
          </p>

          {itemName && (
            <div className="bg-[#18191B] border border-[#393B3F] rounded-xl px-3.5 py-2.5 flex items-center space-x-2">
              <span className="text-xs text-[#FFF5F5]/40 font-mono">Target:</span>
              <span className="text-xs font-semibold text-[#F7D7D1] truncate">{itemName}</span>
            </div>
          )}

          {isDestructive && (
            <p className="text-xs text-rose-400/90 font-medium flex items-center space-x-1.5">
              <span>
                ⚠️ This action cannot be undone. All timeline versions, edits, and assets will be
                purged.
              </span>
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 bg-[#1C1D1F] border-t border-[#393B3F] flex items-center justify-end space-x-3">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[#FFF5F5]/70 hover:text-[#FFF5F5] hover:bg-[#2A2C2F] transition-colors border border-transparent hover:border-[#393B3F] disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shadow-sm disabled:opacity-50 ${
              isDestructive
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B]'
            }`}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
