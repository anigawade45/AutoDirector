import React, { useState } from 'react';
import {
  X,
  Mail,
  Lock,
  User,
  Sparkles,
  ArrowRight,
  Loader2,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';

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
  const [mode, setMode] = useState<'login' | 'register'>(defaultMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tier, setTier] = useState<'free' | 'pro' | 'enterprise'>(initialTier);
  const [localError, setLocalError] = useState<string | null>(null);

  const { login, register, isLoading, error, clearError } = useAuthStore();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!email.trim() || !password.trim()) {
      setLocalError('Please provide both email and password.');
      toast.warning('Please provide both email and password.', 'Required Fields');
      return;
    }

    if (mode === 'register') {
      if (!name.trim()) {
        setLocalError('Please enter your full name.');
        toast.warning('Please enter your full name.', 'Name Required');
        return;
      }
      if (password.length < 6) {
        setLocalError('Password must be at least 6 characters.');
        toast.warning('Password must be at least 6 characters.', 'Password Length');
        return;
      }

      const ok = await register({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        tier,
      });
      if (ok) {
        onClose();
      }
    } else {
      const ok = await login({
        email: email.trim().toLowerCase(),
        password,
      });
      if (ok) {
        onClose();
      }
    }
  };

  const displayError = localError || error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-[#222326] border border-[#393B3F] rounded-2xl shadow-2xl p-6 sm:p-8 text-[#FFF5F5] my-auto"
        onClick={(e) => e.stopPropagation()}
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
            {mode === 'login' ? 'Studio Authentication' : 'Create Studio Account'}
          </h2>
          <p className="text-xs text-[#FFF5F5]/70 mt-1">
            {mode === 'login'
              ? 'Access your projects, plans, and persistent render history'
              : 'Join the next-generation video creation suite'}
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 p-1 bg-[#18191B] border border-[#393B3F] rounded-xl mb-6">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              clearError();
              setLocalError(null);
            }}
            className={`py-2 text-xs font-semibold rounded-lg transition-all ${
              mode === 'login'
                ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm font-bold'
                : 'text-[#FFF5F5]/70 hover:text-[#FFF5F5]'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              clearError();
              setLocalError(null);
            }}
            className={`py-2 text-xs font-semibold rounded-lg transition-all ${
              mode === 'register'
                ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm font-bold'
                : 'text-[#FFF5F5]/70 hover:text-[#FFF5F5]'
            }`}
          >
            Register
          </button>
        </div>

        {/* Error notification */}
        {displayError && (
          <div className="mb-4 p-3 bg-red-950/40 border border-red-800/50 rounded-xl text-xs text-red-300 flex items-start space-x-2">
            <span className="font-bold">Error:</span>
            <span>{displayError}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#FFF5F5]/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Elena Rostova"
                  className="w-full pl-10 pr-4 py-2.5 bg-[#18191B] border border-[#393B3F] rounded-xl text-xs text-[#FFF5F5] placeholder-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE] transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#FFF5F5]/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full pl-10 pr-4 py-2.5 bg-[#18191B] border border-[#393B3F] rounded-xl text-xs text-[#FFF5F5] placeholder-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#FFF5F5]/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-[#18191B] border border-[#393B3F] rounded-xl text-xs text-[#FFF5F5] placeholder-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE] transition-colors"
              />
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
                Edition Tier
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['free', 'pro', 'enterprise'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTier(t)}
                    className={`py-2 px-2.5 rounded-xl border text-center transition-all ${
                      tier === t
                        ? 'border-[#E3B5BE] bg-[#E3B5BE]/10 text-[#F7D7D1] font-semibold'
                        : 'border-[#393B3F] bg-[#18191B] text-[#FFF5F5]/60 hover:border-[#484949]'
                    }`}
                  >
                    <div className="text-xs capitalize">{t}</div>
                    <div className="text-[10px] text-[#FFF5F5]/50 font-mono">
                      {t === 'free' ? '$0' : t === 'pro' ? '$29/mo' : '$99/mo'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 px-4 bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#18191B]" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <span>{mode === 'login' ? 'Sign In to Studio' : 'Create Free Account'}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer Security Badge */}
        <div className="mt-6 flex items-center justify-center space-x-2 text-[11px] font-mono text-[#FFF5F5]/50">
          <ShieldCheck className="w-3.5 h-3.5 text-[#E3B5BE]" />
          <span>Secured with Salted Scrypt Hashing & RFC 7519 JWT</span>
        </div>
      </div>
    </div>
  );
};
