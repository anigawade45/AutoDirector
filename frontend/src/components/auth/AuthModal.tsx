import React from 'react';
import { X } from 'lucide-react';
import { AuthForm } from './AuthForm';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'login' | 'register';
  initialTier?: 'free' | 'pro' | 'enterprise';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  defaultMode = 'login',
  initialTier = 'pro',
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-[#222326] border border-[#393B3F] rounded-2xl shadow-2xl p-6 sm:p-8 text-[#FFF5F5] my-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Studio Authentication"
      >
        {/* Glow accent */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#F7D7D1]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-[#E3B5BE]/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-lg text-[#FFF5F5]/60 hover:text-[#FFF5F5] hover:bg-[#2A2C2F] transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-[#2A2C2F] border border-[#393B3F] text-[#F7D7D1] text-[11px] font-mono tracking-wide mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E3B5BE]" />
            <span>AutoDirector Studio</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[#FFF5F5]">
            Studio Authentication
          </h2>
          <p className="text-xs text-[#FFF5F5]/70 mt-1">
            Access your projects, plans, and persistent render history
          </p>
        </div>

        {/* Unified Auth Form */}
        <AuthForm
          initialMode={defaultMode}
          initialTier={initialTier}
          onSuccess={onClose}
          showSecurityBadge={true}
        />
      </div>
    </div>
  );
};
