import React, { useState } from 'react';
import { Mail, Lock, User, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';

export interface AuthFormProps {
  initialMode?: 'login' | 'register';
  initialTier?: 'free' | 'pro' | 'enterprise';
  onSuccess?: () => void;
  showSecurityBadge?: boolean;
  className?: string;
}

export const AuthForm: React.FC<AuthFormProps> = ({
  initialMode = 'login',
  initialTier = 'pro',
  onSuccess,
  showSecurityBadge = true,
  className = '',
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tier, setTier] = useState<'free' | 'pro' | 'enterprise'>(initialTier);
  const [rememberMe, setRememberMe] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const { login, register, isLoading, error, clearError } = useAuthStore();

  const handleModeChange = (newMode: 'login' | 'register') => {
    setMode(newMode);
    clearError();
    setLocalError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setLocalError('Please provide both email and password.');
      toast.warning('Please provide both email and password.', 'Required Fields');
      return;
    }

    if (mode === 'register') {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setLocalError('Please enter your full name.');
        toast.warning('Please enter your full name.', 'Name Required');
        return;
      }
      if (trimmedPassword.length < 6) {
        setLocalError('Password must be at least 6 characters.');
        toast.warning('Password must be at least 6 characters.', 'Password Length');
        return;
      }

      const ok = await register({
        name: trimmedName,
        email: trimmedEmail,
        password: trimmedPassword,
        tier,
      });

      if (ok && onSuccess) {
        onSuccess();
      }
    } else {
      const ok = await login({
        email: trimmedEmail,
        password: trimmedPassword,
        rememberMe,
      });

      if (ok && onSuccess) {
        onSuccess();
      }
    }
  };

  const displayError = localError || error;

  return (
    <div className={`w-full ${className}`}>
      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-2 p-1 bg-[#18191B] border border-[#393B3F] rounded-xl mb-6">
        <button
          type="button"
          onClick={() => handleModeChange('login')}
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
          onClick={() => handleModeChange('register')}
          className={`py-2 text-xs font-semibold rounded-lg transition-all ${
            mode === 'register'
              ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm font-bold'
              : 'text-[#FFF5F5]/70 hover:text-[#FFF5F5]'
          }`}
        >
          Create Account
        </button>
      </div>

      {/* Error Banner */}
      {displayError && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-950/40 border border-red-800/50 rounded-xl text-xs text-red-300 flex items-start space-x-2 animate-in fade-in duration-200"
        >
          <span className="font-bold">Error:</span>
          <span>{displayError}</span>
        </div>
      )}

      {/* Form Fields */}
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
              placeholder="•••••••• (min. 6 characters)"
              className="w-full pl-10 pr-4 py-2.5 bg-[#18191B] border border-[#393B3F] rounded-xl text-xs text-[#FFF5F5] placeholder-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE] transition-colors"
            />
          </div>
        </div>

        {mode === 'login' && (
          <div className="flex items-center justify-between text-xs text-[#FFF5F5]/70 pt-0.5">
            <label className="flex items-center space-x-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-[#18191B] border-[#393B3F] text-[#E3B5BE] focus:ring-0 focus:outline-none"
              />
              <span className="text-[11px] font-mono text-[#FFF5F5]/80">Remember this device</span>
            </label>
            <span className="text-[10px] text-[#FFF5F5]/40 font-mono">
              {rememberMe ? 'Persistent session' : 'Tab session only'}
            </span>
          </div>
        )}

        {mode === 'register' && (
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
              Select Plan Edition
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
              <span>Authenticating...</span>
            </>
          ) : (
            <>
              <span>{mode === 'login' ? 'Sign In to Studio' : 'Create Studio Account'}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      {/* Security info */}
      {showSecurityBadge && (
        <div className="mt-5 flex items-center justify-center space-x-2 text-[11px] font-mono text-[#FFF5F5]/50">
          <ShieldCheck className="w-3.5 h-3.5 text-[#E3B5BE]" />
          <span>End-to-End Encrypted Secure Authentication</span>
        </div>
      )}
    </div>
  );
};
