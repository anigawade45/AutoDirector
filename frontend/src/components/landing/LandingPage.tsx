import React, { useState } from 'react';
import {
  Film,
  ArrowRight,
  Play,
  Scissors,
  Type,
  Palette,
  Volume2,
  GitBranch,
  Check,
  Zap,
  Sliders,
  ShieldCheck,
  Clapperboard,
  Sparkles,
  ChevronDown,
  Mail,
  Lock,
  LogIn,
  User,
  Loader2,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { AuthModal } from '../auth/AuthModal';
import { toast } from '../../stores/toastStore';

interface LandingPageProps {
  onEnterStudio: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnterStudio }) => {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [selectedTier, setSelectedTier] = useState<'free' | 'pro' | 'enterprise'>('pro');

  // Inline auth section state
  const [inlineMode, setInlineMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tier, setTier] = useState<'free' | 'pro' | 'enterprise'>('pro');
  const [inlineError, setInlineError] = useState<string | null>(null);

  const { isAuthenticated, user, login, register, logout, isLoading, error, clearError } = useAuthStore();

  const handleOpenAuth = (mode: 'login' | 'register', tier: 'free' | 'pro' | 'enterprise' = 'pro') => {
    setAuthMode(mode);
    setSelectedTier(tier);
    setAuthModalOpen(true);
  };

  const scrollToAuth = (mode: 'login' | 'register', tierChoice: 'free' | 'pro' | 'enterprise' = 'pro') => {
    setInlineMode(mode);
    setTier(tierChoice);
    setInlineError(null);
    clearError();
    const el = document.getElementById('access');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    } else {
      handleOpenAuth(mode, tierChoice);
    }
  };

  const handleInlineAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);
    clearError();

    if (!email.trim() || !password.trim()) {
      setInlineError('Please provide both email and password.');
      toast.warning('Please provide both email and password.', 'Required Fields');
      return;
    }

    if (inlineMode === 'register') {
      if (!name.trim()) {
        setInlineError('Please enter your full name.');
        toast.warning('Please enter your full name.', 'Name Required');
        return;
      }
      if (password.length < 6) {
        setInlineError('Password must be at least 6 characters.');
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
        onEnterStudio();
      }
    } else {
      const ok = await login({
        email: email.trim().toLowerCase(),
        password,
      });
      if (ok) {
        onEnterStudio();
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#18191B] text-[#FFF5F5] font-sans antialiased selection:bg-[#E3B5BE] selection:text-[#18191B]">
      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
          if (useAuthStore.getState().isAuthenticated) {
            onEnterStudio();
          }
        }}
        defaultMode={authMode}
        initialTier={selectedTier}
      />

      {/* Top Header / Navigation */}
      <header className="sticky top-0 z-40 h-16 sm:h-20 border-b border-[#393B3F]/60 bg-[#18191B]/90 backdrop-blur-md px-4 sm:px-6 md:px-12 flex items-center justify-between transition-all">
        <div
          className="flex items-center space-x-2.5 sm:space-x-3.5 cursor-pointer group"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-[#2A2C2F] border border-[#E3B5BE]/30 flex items-center justify-center text-[#E3B5BE] shadow-sm group-hover:border-[#E3B5BE] transition-colors shrink-0">
            <Clapperboard className="w-4 h-4 text-[#E3B5BE]" />
          </div>
          <div className="flex items-baseline space-x-1.5 sm:space-x-2">
            <span className="font-bold text-base sm:text-lg tracking-tight text-[#FFF5F5]">
              AutoDirector
            </span>
            <span className="text-[10px] sm:text-[11px] font-mono text-[#F7D7D1]/70 tracking-wider uppercase">
              Studio
            </span>
          </div>
        </div>

        <nav className="hidden md:flex items-center space-x-7 lg:space-x-9 text-xs uppercase tracking-widest text-[#FFF5F5]/70 font-medium">
          <a href="#editorial" className="hover:text-[#FFF5F5] transition-colors">Philosophy</a>
          <a href="#workbench" className="hover:text-[#FFF5F5] transition-colors">Workbench</a>
          <a href="#capabilities" className="hover:text-[#FFF5F5] transition-colors">Capabilities</a>
          <a href="#editions" className="hover:text-[#FFF5F5] transition-colors">Editions</a>
          <a href="#access" className="hover:text-[#FFF5F5] text-[#F7D7D1] transition-colors">Sign In / Register</a>
        </nav>

        <div className="flex items-center space-x-2 sm:space-x-3">
          {isAuthenticated ? (
            <button
              onClick={onEnterStudio}
              className="flex items-center space-x-1.5 sm:space-x-2 bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-semibold text-xs px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg shadow-sm transition-all active:scale-95"
            >
              <span>Open Studio</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              <button
                onClick={() => scrollToAuth('login')}
                className="text-xs font-semibold text-[#FFF5F5]/80 hover:text-[#FFF5F5] px-2.5 sm:px-3 py-2 rounded-lg hover:bg-[#2A2C2F] transition-colors"
              >
                Sign In
              </button>
              <button
                onClick={() => scrollToAuth('register', 'free')}
                className="flex items-center space-x-1 sm:space-x-1.5 bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold text-xs px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg shadow-sm transition-all active:scale-95"
              >
                <span>Try Free</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-10 sm:pt-16 md:pt-24 pb-12 sm:pb-16 md:pb-20 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto">
        {/* Subtle, warm organic radial lighting */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 w-[650px] h-[340px] bg-gradient-to-b from-[#F7D7D1]/10 via-[#E3B5BE]/5 to-transparent blur-[120px] rounded-full pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#2A2C2F] border border-[#F7D7D1]/20 text-[#F7D7D1] text-[11px] sm:text-xs font-mono tracking-wide mb-6 sm:mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E3B5BE] shrink-0" />
            <span className="hidden sm:inline">The Editorial Room • Reimagined for Modern Filmmaking</span>
            <span className="sm:hidden">The Editorial Room • Modern Filmmaking</span>
          </div>

          <h1 className="text-[32px] xs:text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight text-[#FFF5F5] leading-[1.12] mb-5 sm:mb-7">
            Direct video edits with{' '}
            <span className="font-serif italic font-normal text-[#F7D7D1]">
              editorial precision.
            </span>
          </h1>

          <p className="text-sm sm:text-base md:text-lg text-[#FFF5F5]/75 leading-relaxed max-w-2xl mx-auto mb-7 sm:mb-10 font-normal">
            A conversational cutting room built on deterministic multi-pass rendering, Whisper word-sync,
            and reversible version trees. Speak your creative vision; let the director cut, grade, and pace.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-8 sm:mb-14">
            <button
              onClick={() => (isAuthenticated ? onEnterStudio() : scrollToAuth('register', 'free'))}
              className="w-full sm:w-auto px-7 py-3.5 rounded-lg bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-sm active:scale-95"
            >
              <span>Begin Creating Free</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => {
                if (isAuthenticated) {
                  onEnterStudio();
                } else {
                  scrollToAuth('login');
                }
              }}
              className="w-full sm:w-auto px-6 py-3.5 rounded-lg bg-[#2A2C2F] hover:bg-[#34373B] border border-[#393B3F] text-[#FFF5F5] font-semibold text-xs transition-all flex items-center justify-center space-x-2 active:scale-95"
            >
              <LogIn className="w-3.5 h-3.5 text-[#F7D7D1]" />
              <span>Sign In to Studio</span>
            </button>
          </div>

          {/* Quality Principles Bar - Compact 2x2 on mobile, 4-col on desktop */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4 p-3.5 sm:p-5 rounded-xl bg-[#222326] border border-[#393B3F]/70 text-left">
            <div className="p-3 sm:p-3.5 rounded-lg bg-[#18191B]/60 border border-[#393B3F]/40 flex flex-col justify-between">
              <div>
                <div className="text-[10px] sm:text-xs font-mono uppercase text-[#F7D7D1] tracking-wider mb-0.5 sm:mb-1">Architecture</div>
                <div className="text-xs sm:text-sm font-semibold text-[#FFF5F5]">Deterministic 5-Pass</div>
              </div>
              <div className="text-[10px] sm:text-[11px] text-[#FFF5F5]/60 mt-1">Pixel-exact timeline export</div>
            </div>
            <div className="p-3 sm:p-3.5 rounded-lg bg-[#18191B]/60 border border-[#393B3F]/40 flex flex-col justify-between">
              <div>
                <div className="text-[10px] sm:text-xs font-mono uppercase text-[#F7D7D1] tracking-wider mb-0.5 sm:mb-1">Responsiveness</div>
                <div className="text-xs sm:text-sm font-semibold text-[#FFF5F5]">&lt; 100ms Seek Latency</div>
              </div>
              <div className="text-[10px] sm:text-[11px] text-[#FFF5F5]/60 mt-1">Fluid multi-track scrubbing</div>
            </div>
            <div className="p-3 sm:p-3.5 rounded-lg bg-[#18191B]/60 border border-[#393B3F]/40 flex flex-col justify-between">
              <div>
                <div className="text-[10px] sm:text-xs font-mono uppercase text-[#F7D7D1] tracking-wider mb-0.5 sm:mb-1">Typography</div>
                <div className="text-xs sm:text-sm font-semibold text-[#FFF5F5]">Whisper Word-Pop</div>
              </div>
              <div className="text-[10px] sm:text-[11px] text-[#FFF5F5]/60 mt-1">Real-time phonetic sync</div>
            </div>
            <div className="p-3 sm:p-3.5 rounded-lg bg-[#18191B]/60 border border-[#393B3F]/40 flex flex-col justify-between">
              <div>
                <div className="text-[10px] sm:text-xs font-mono uppercase text-[#F7D7D1] tracking-wider mb-0.5 sm:mb-1">Safety</div>
                <div className="text-xs sm:text-sm font-semibold text-[#FFF5F5]">Branching History</div>
              </div>
              <div className="text-[10px] sm:text-[11px] text-[#FFF5F5]/60 mt-1">Instant lossless time-travel</div>
            </div>
          </div>

          {/* Animated Scroll Label / Cue */}
          <div className="mt-8 sm:mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#access"
              className="inline-flex items-center space-x-2 text-[11px] sm:text-xs font-mono text-[#F7D7D1] hover:text-[#FFF5F5] bg-[#222326] px-4 py-2 rounded-full border border-[#E3B5BE]/60 transition-all hover:bg-[#2A2C2F] group shadow-sm active:scale-95"
            >
              <User className="w-3.5 h-3.5 text-[#E3B5BE]" />
              <span>Scroll to Login & Registration Form</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#E3B5BE] group-hover:translate-y-0.5 transition-transform animate-bounce" />
            </a>
            <a
              href="#workbench"
              className="inline-flex items-center space-x-2 text-[11px] sm:text-xs font-mono text-[#FFF5F5]/70 hover:text-[#F7D7D1] bg-[#222326] px-4 py-2 rounded-full border border-[#393B3F] transition-all hover:border-[#E3B5BE]/60 group shadow-sm active:scale-95"
            >
              <span>Inspect Workbench Interface</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#E3B5BE] group-hover:translate-y-0.5 transition-transform" />
            </a>
          </div>
        </div>

        {/* Workbench Mockup Showcase */}
        <div id="workbench" className="mt-14 sm:mt-20 relative rounded-2xl border border-[#393B3F] bg-[#222326] shadow-xl overflow-hidden">
          {/* Header Bar */}
          <div className="h-11 border-b border-[#393B3F] px-3 sm:px-4 bg-[#1C1D1F] flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0 flex-1 mr-3">
              <span className="w-2.5 h-2.5 rounded-full bg-[#E3B5BE]/60 shrink-0" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#F7D7D1]/60 shrink-0" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#484949] shrink-0" />
              <span className="text-[11px] sm:text-xs font-mono text-[#FFF5F5]/60 ml-1.5 sm:ml-2 truncate">
                workbench / Active_Project_Timeline.mp4 • v1
              </span>
            </div>
            <div className="flex items-center space-x-1.5 text-[10px] sm:text-[11px] font-mono text-[#F7D7D1] shrink-0">
              <span className="w-2 h-2 rounded-full bg-[#E3B5BE] animate-pulse" />
              <span className="hidden sm:inline">Pipeline Calibrated</span>
            </div>
          </div>

          {/* Workbench Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[480px]">
            {/* Center Player & Timeline */}
            <div className="lg:col-span-8 p-3 sm:p-6 bg-[#18191B] flex flex-col justify-between">
              {/* Video Monitor Frame */}
              <div className="relative aspect-video rounded-xl bg-[#121314] border border-[#393B3F] overflow-hidden flex items-center justify-center group shadow-inner">
                {/* Warm Cinematic Ambient Wash */}
                <div className="absolute inset-0 bg-gradient-to-tr from-[#1E1F21] via-[#2A2827] to-[#1F1D1C] opacity-90" />

                {/* Simulated Kinetic Subtitle */}
                <div className="relative z-10 text-center px-4 sm:px-6 max-w-lg">
                  <div className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-[#E3B5BE] mb-2 sm:mb-2.5">
                    Active Frame Preview
                  </div>
                  <div className="text-lg sm:text-2xl md:text-3xl font-bold text-[#FFF5F5] drop-shadow-md tracking-tight">
                    Golden hour over the{' '}
                    <span className="text-[#F7D7D1] border-b-2 border-[#E3B5BE] pb-0.5">
                      rocky coastline
                    </span>
                  </div>
                </div>

                {/* Player Bottom Control Strip */}
                <div className="absolute bottom-2 sm:bottom-3 left-2 sm:left-4 right-2 sm:right-4 h-8 sm:h-10 px-2 sm:px-3.5 bg-[#222326]/90 backdrop-blur-md rounded-lg border border-[#393B3F] flex items-center justify-between text-xs text-[#FFF5F5]/80 font-mono gap-1">
                  <div className="flex items-center space-x-2 sm:space-x-3">
                    <button
                      onClick={() => {
                        if (isAuthenticated) {
                          onEnterStudio();
                        } else {
                          toast.warning(
                            'Please sign in or create an account to view the video studio',
                            'Authentication Required'
                          );
                          scrollToAuth('login');
                        }
                      }}
                      className="text-[#E3B5BE] hover:text-[#FFF5F5] transition-colors"
                      title="Launch Player in Studio"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                    <span className="text-[9px] sm:text-[11px] text-[#FFF5F5]">00:04.200 / 00:58.400</span>
                  </div>
                  <div className="flex items-center space-x-1.5 sm:space-x-2 text-[10px]">
                    <span className="px-1.5 sm:px-2 py-0.5 rounded bg-[#2A2C2F] text-[#F7D7D1] border border-[#393B3F] text-[9px] sm:text-[10px]">
                      Kodak 35mm
                    </span>
                    <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-[#2A2C2F] text-[#E3B5BE] border border-[#393B3F]">
                      -14 LUFS Normalized
                    </span>
                  </div>
                </div>
              </div>

              {/* Multi-Track Timeline Simulation */}
              <div className="mt-4 sm:mt-5 p-3 sm:p-3.5 bg-[#222326] rounded-xl border border-[#393B3F] space-y-2">
                <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-mono text-[#FFF5F5]/60 mb-1">
                  <span>TIMELINE SEQUENCE</span>
                  <span className="hidden xs:inline">1080P @ 30 FPS • PRORES PROXY</span>
                </div>
                {/* Track 1: Video */}
                <div className="flex items-center space-x-2 sm:space-x-2.5">
                  <span className="w-16 sm:w-20 text-[9px] sm:text-[10px] font-mono font-semibold uppercase text-[#E3B5BE] shrink-0">
                    V1 Footage
                  </span>
                  <div className="flex-1 min-w-0 h-6 bg-[#2A2C2F] border border-[#393B3F] rounded flex items-center px-2 text-[9px] sm:text-[10px] text-[#FFF5F5]/80 font-mono overflow-hidden">
                    <span className="truncate">Source_Timeline.mp4 [4 silences excised]</span>
                  </div>
                </div>
                {/* Track 2: Subtitles */}
                <div className="flex items-center space-x-2 sm:space-x-2.5">
                  <span className="w-16 sm:w-20 text-[9px] sm:text-[10px] font-mono font-semibold uppercase text-[#F7D7D1] shrink-0">
                    V2 Captions
                  </span>
                  <div className="flex-1 min-w-0 h-6 bg-[#2A2C2F] border border-[#E3B5BE]/30 rounded flex items-center px-2 text-[9px] sm:text-[10px] text-[#F7D7D1] font-mono overflow-hidden">
                    <span className="truncate">Whisper Kinetic Word-Pop</span>
                  </div>
                </div>
                {/* Track 3: Audio */}
                <div className="flex items-center space-x-2 sm:space-x-2.5">
                  <span className="w-16 sm:w-20 text-[9px] sm:text-[10px] font-mono font-semibold uppercase text-[#FFF5F5]/60 shrink-0">
                    A1 Ambient
                  </span>
                  <div className="flex-1 min-w-0 h-6 bg-[#2A2C2F] border border-[#393B3F] rounded flex items-center px-2 text-[9px] sm:text-[10px] text-[#FFF5F5]/70 font-mono overflow-hidden">
                    <span className="truncate">Lofi_Sunset_Stereo.wav (-12dB duck)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Director Console */}
            <div className="lg:col-span-4 p-4 sm:p-6 bg-[#1C1D1F] border-t lg:border-t-0 lg:border-l border-[#393B3F] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 sm:pb-3.5 border-b border-[#393B3F] mb-3 sm:mb-4">
                  <div className="flex items-center space-x-2">
                    <Sliders className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#E3B5BE]" />
                    <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-[#FFF5F5]">
                      Editorial Instructions
                    </span>
                  </div>
                  <span className="text-[9px] sm:text-[10px] font-mono px-2 py-0.5 bg-[#2A2C2F] text-[#F7D7D1] rounded border border-[#393B3F]">
                    Director Core
                  </span>
                </div>

                <div className="space-y-2.5 sm:space-y-3">
                  <div className="p-2.5 sm:p-3 rounded-lg bg-[#222326] border border-[#393B3F] text-xs">
                    <span className="text-[9px] sm:text-[10px] font-mono text-[#E3B5BE] block mb-1 uppercase tracking-wider">
                      Instruction 01
                    </span>
                    <p className="text-[11px] sm:text-xs text-[#FFF5F5]/90">
                      "Remove all silent breath pauses longer than 0.6 seconds."
                    </p>
                  </div>

                  <div className="p-2.5 sm:p-3 rounded-lg bg-[#222326] border border-[#393B3F] text-xs">
                    <span className="text-[9px] sm:text-[10px] font-mono text-[#F7D7D1] block mb-1 uppercase tracking-wider">
                      Instruction 02
                    </span>
                    <p className="text-[11px] sm:text-xs text-[#FFF5F5]/90">
                      "Apply a warm 35mm film grade with softened highlights and gentle vignette."
                    </p>
                  </div>

                  <div className="p-2.5 sm:p-3 rounded-lg bg-[#222326] border border-[#393B3F] text-xs">
                    <span className="text-[9px] sm:text-[10px] font-mono text-[#E3B5BE] block mb-1 uppercase tracking-wider">
                      Instruction 03
                    </span>
                    <p className="text-[11px] sm:text-xs text-[#FFF5F5]/90">
                      "Generate word-pop subtitles with cream text and soft peach active word highlights."
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-4 sm:pt-5 border-t border-[#393B3F] mt-4 lg:mt-0">
                <button
                  onClick={() => {
                    if (isAuthenticated) {
                      onEnterStudio();
                    } else {
                      toast.warning(
                        'Please sign in or create an account to view the video studio',
                        'Authentication Required'
                      );
                      scrollToAuth('login');
                    }
                  }}
                  className="w-full py-2.5 px-4 bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold text-xs uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center space-x-2 shadow-sm"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Launch Studio Workspace</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities Grid */}
      <section id="capabilities" className="py-14 sm:py-20 md:py-24 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto border-t border-[#393B3F]/70">
        <div className="max-w-2xl mb-16">
          <div className="text-xs font-mono uppercase tracking-widest text-[#E3B5BE] mb-2">
            Features & Precision
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#FFF5F5]">
            Engineered for editors who value control over black-box guesswork.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1 */}
          <div className="p-6 rounded-xl bg-[#222326] border border-[#393B3F] hover:border-[#E3B5BE]/60 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-center text-[#E3B5BE] mb-5 group-hover:border-[#E3B5BE] transition-colors">
              <Scissors className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#FFF5F5] mb-2">Voice Activity Excision</h3>
            <p className="text-xs text-[#FFF5F5]/70 leading-relaxed">
              Heuristic Voice Activity Detection parses raw audio down to 100ms grains. Removes dead air without sacrificing natural conversational breathing.
            </p>
          </div>

          {/* Card 2 */}
          <div className="p-6 rounded-xl bg-[#222326] border border-[#393B3F] hover:border-[#E3B5BE]/60 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-center text-[#F7D7D1] mb-5 group-hover:border-[#F7D7D1] transition-colors">
              <Type className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#FFF5F5] mb-2">Kinetic Subtitle Typography</h3>
            <p className="text-xs text-[#FFF5F5]/70 leading-relaxed">
              Whisper timestamped word-by-word alignment with active highlight styling. Clean typography that keeps viewers engaged across social feeds.
            </p>
          </div>

          {/* Card 3 */}
          <div className="p-6 rounded-xl bg-[#222326] border border-[#393B3F] hover:border-[#E3B5BE]/60 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-center text-[#E3B5BE] mb-5 group-hover:border-[#E3B5BE] transition-colors">
              <Palette className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#FFF5F5] mb-2">Color Science & LUT Matrix</h3>
            <p className="text-xs text-[#FFF5F5]/70 leading-relaxed">
              Warm 35mm film, modern teal & orange, noir mono, and gentle saturation curves compiled via non-destructive FFmpeg matrix transforms.
            </p>
          </div>

          {/* Card 4 */}
          <div className="p-6 rounded-xl bg-[#222326] border border-[#393B3F] hover:border-[#E3B5BE]/60 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-center text-[#F7D7D1] mb-5 group-hover:border-[#F7D7D1] transition-colors">
              <Volume2 className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#FFF5F5] mb-2">Intelligent Audio Ducking</h3>
            <p className="text-xs text-[#FFF5F5]/70 leading-relaxed">
              Smooth sidechain volume dip whenever speech is detected, normalized to -14 LUFS broadcast standards with true-peak limiter preservation.
            </p>
          </div>

          {/* Card 5 */}
          <div className="p-6 rounded-xl bg-[#222326] border border-[#393B3F] hover:border-[#E3B5BE]/60 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-center text-[#E3B5BE] mb-5 group-hover:border-[#E3B5BE] transition-colors">
              <GitBranch className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#FFF5F5] mb-2">Reversible Version Tree</h3>
            <p className="text-xs text-[#FFF5F5]/70 leading-relaxed">
              Every cut, color grade, and subtitle track is an immutable JSON operation. Jump backward or forward in history with guaranteed state integrity.
            </p>
          </div>

          {/* Card 6 */}
          <div className="p-6 rounded-xl bg-[#222326] border border-[#393B3F] hover:border-[#E3B5BE]/60 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-center text-[#F7D7D1] mb-5 group-hover:border-[#F7D7D1] transition-colors">
              <Film className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#FFF5F5] mb-2">High-Resolution Pipeline</h3>
            <p className="text-xs text-[#FFF5F5]/70 leading-relaxed">
              From 480p real-time canvas preview to full 4K UHD 60fps master exports. Pure FFmpeg native compilation without cloud lock-in.
            </p>
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <section id="editorial" className="py-14 sm:py-20 md:py-24 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto border-t border-[#393B3F]/70">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-[#F7D7D1] mb-3">
              Editorial Philosophy
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#FFF5F5] mb-6">
              AI should be your skilled assistant editor, not a random filter.
            </h2>
            <p className="text-sm text-[#FFF5F5]/75 leading-relaxed mb-4">
              Most automated video tools apply generic templates that rob footage of its character. AutoDirector approaches every project through the discipline of traditional film editing: pacing, rhythm, audio hierarchy, and color cohesion.
            </p>
            <p className="text-sm text-[#FFF5F5]/75 leading-relaxed">
              You maintain total inspector access to every keyframe, cut point, and typography parameter. Direct high-level creative directions, then fine-tune down to individual milliseconds.
            </p>
          </div>

          <div className="p-4 sm:p-8 rounded-2xl bg-[#222326] border border-[#393B3F] space-y-4 font-mono text-xs text-[#FFF5F5]/80 overflow-x-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#393B3F] gap-2">
              <span className="text-[#E3B5BE] text-[10px] sm:text-xs">PROMPT_SPECIFICATION</span>
              <span className="text-[#F7D7D1] text-[10px] sm:text-xs">COMPILED_PLAN_V16</span>
            </div>
            <div className="space-y-2 text-[10px] sm:text-[11px] leading-relaxed text-[#FFF5F5]/70">
              <p>&gt; Audio analysis: 4 dead air pauses detected [1.2s, 0.8s, 1.4s, 0.9s]</p>
              <p>&gt; Silence excision filter generated with 120ms safety boundary</p>
              <p>&gt; Whisper alignment: 16 subtitle cues synchronized to phonetic start times</p>
              <p>&gt; Color grade: Kodak 35mm LUT applied (gamma: 1.05, sat: 0.95, vignette: 0.25)</p>
              <p>&gt; Audio ducking: speech trigger mapped to music layer at -12dB attenuation</p>
            </div>
            <div className="pt-3 border-t border-[#393B3F] text-[9px] sm:text-[10px] text-[#E3B5BE] flex flex-col xs:flex-row xs:items-center justify-between gap-1">
              <span>Deterministic validation: PASSED (0 schema errors)</span>
              <span>Render latency: 1.8s</span>
            </div>
          </div>
        </div>
      </section>

      {/* Editions / Pricing Matrix */}
      <section id="editions" className="py-14 sm:py-20 md:py-24 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto border-t border-[#393B3F]/70">
        <div className="max-w-2xl mx-auto text-center mb-12 sm:mb-16">
          <div className="text-xs font-mono uppercase tracking-widest text-[#E3B5BE] mb-2">
            Studio Editions
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-[#FFF5F5] mb-3">
            Predictable plans crafted for creators and production houses.
          </h2>
          <p className="text-xs sm:text-sm text-[#FFF5F5]/70">
            Start free, direct without constraints, and upgrade when resolution demands it.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
          {/* Free Edition */}
          <div className="p-5 sm:p-8 rounded-2xl bg-[#222326] border border-[#393B3F] flex flex-col justify-between">
            <div>
              <div className="text-xs font-mono uppercase text-[#F7D7D1] mb-1">Creator Edition</div>
              <h3 className="text-xl font-bold text-[#FFF5F5] mb-4">Free Studio</h3>
              <div className="text-3xl font-bold text-[#FFF5F5] mb-6">
                $0<span className="text-xs font-normal text-[#FFF5F5]/60"> / month</span>
              </div>

              <ul className="space-y-3 text-xs text-[#FFF5F5]/80 mb-8">
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#E3B5BE] shrink-0" />
                  <span>100 AI prompts per day</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#E3B5BE] shrink-0" />
                  <span>60 Render minutes per month</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#E3B5BE] shrink-0" />
                  <span>5 GB Media storage</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#E3B5BE] shrink-0" />
                  <span>1080p FHD video exports</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#E3B5BE] shrink-0" />
                  <span>Interactive timeline & word-pop</span>
                </li>
              </ul>
            </div>

            <button
              onClick={() => scrollToAuth('register', 'free')}
              className="w-full py-2.5 rounded-lg border border-[#393B3F] bg-[#2A2C2F] hover:bg-[#34373B] text-[#FFF5F5] text-xs font-semibold uppercase tracking-wider transition-colors"
            >
              Get Started
            </button>
          </div>

          {/* Director Pro (Highlighted) */}
          <div className="p-5 sm:p-8 rounded-2xl bg-[#272628] border-2 border-[#E3B5BE] shadow-xl flex flex-col justify-between relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-[#E3B5BE] text-[#18191B] text-[10px] font-mono font-bold uppercase tracking-wider">
              Director Choice
            </div>

            <div>
              <div className="text-xs font-mono uppercase text-[#F7D7D1] mb-1">Professional Suite</div>
              <h3 className="text-xl font-bold text-[#FFF5F5] mb-4">Director Pro</h3>
              <div className="text-3xl font-bold text-[#FFF5F5] mb-6">
                $29<span className="text-xs font-normal text-[#FFF5F5]/60"> / month</span>
              </div>

              <ul className="space-y-3 text-xs text-[#FFF5F5]/90 mb-8">
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#F7D7D1] shrink-0" />
                  <span><strong>500 AI prompts</strong> per day</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#F7D7D1] shrink-0" />
                  <span><strong>300 Render minutes</strong> per month</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#F7D7D1] shrink-0" />
                  <span><strong>20 GB High-speed storage</strong></span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#F7D7D1] shrink-0" />
                  <span><strong>4K UHD master export</strong> @ 60fps</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#F7D7D1] shrink-0" />
                  <span>Priority render job queue</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#F7D7D1] shrink-0" />
                  <span>Custom color grading & audio ducking</span>
                </li>
              </ul>
            </div>

            <button
              onClick={() => scrollToAuth('register', 'pro')}
              className="w-full py-3 rounded-lg bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] text-xs font-bold uppercase tracking-wider transition-all shadow-sm"
            >
              Start 14-Day Pro Trial
            </button>
          </div>

          {/* Enterprise */}
          <div className="p-5 sm:p-8 rounded-2xl bg-[#222326] border border-[#393B3F] flex flex-col justify-between">
            <div>
              <div className="text-xs font-mono uppercase text-[#F7D7D1] mb-1">Production House</div>
              <h3 className="text-xl font-bold text-[#FFF5F5] mb-4">Studio House</h3>
              <div className="text-3xl font-bold text-[#FFF5F5] mb-6">
                $99<span className="text-xs font-normal text-[#FFF5F5]/60"> / month</span>
              </div>

              <ul className="space-y-3 text-xs text-[#FFF5F5]/80 mb-8">
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#E3B5BE] shrink-0" />
                  <span><strong>1,000 AI prompts</strong> per day</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#E3B5BE] shrink-0" />
                  <span><strong>1,200 Render minutes</strong> per month</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#E3B5BE] shrink-0" />
                  <span><strong>100 GB Cloud storage</strong></span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#E3B5BE] shrink-0" />
                  <span>Dedicated FFmpeg worker cluster</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <Check className="w-3.5 h-3.5 text-[#E3B5BE] shrink-0" />
                  <span>Custom brand LUTs & team access</span>
                </li>
              </ul>
            </div>

            <button
              onClick={() => scrollToAuth('register', 'enterprise')}
              className="w-full py-2.5 rounded-lg border border-[#393B3F] bg-[#2A2C2F] hover:bg-[#34373B] text-[#FFF5F5] text-xs font-semibold uppercase tracking-wider transition-colors"
            >
              Contact Studio Sales
            </button>
          </div>
        </div>
      </section>

      {/* Dedicated Inline Login & Registration Section */}
      <section id="access" className="py-14 sm:py-20 md:py-24 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto border-t border-[#393B3F]/70">
        <div className="max-w-2xl mx-auto text-center mb-10 sm:mb-14">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#2A2C2F] border border-[#393B3F] text-[#F7D7D1] text-[11px] font-mono tracking-wide mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E3B5BE]" />
            <span>Studio Authentication & Access</span>
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-[#FFF5F5] mb-3">
            {isAuthenticated && user ? 'Your Studio Account is Active' : 'Enter the Cutting Room'}
          </h2>
          <p className="text-xs sm:text-sm text-[#FFF5F5]/70 max-w-lg mx-auto">
            {isAuthenticated && user
              ? `You are signed in as ${user.name} on the ${user.tier?.toUpperCase()} edition plan.`
              : 'Sign in to access your video assets and timeline plans, or register in seconds with instant tier evaluation.'}
          </p>
        </div>

        <div className="max-w-xl mx-auto">
          {isAuthenticated && user ? (
            /* Logged in state card */
            <div className="p-6 sm:p-8 rounded-2xl bg-[#222326] border border-[#393B3F] text-center shadow-2xl relative overflow-hidden">
              <div className="w-14 h-14 rounded-full bg-[#2A2C2F] border border-[#E3B5BE]/40 text-[#E3B5BE] text-xl font-bold flex items-center justify-center mx-auto mb-4 shadow-inner">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <h3 className="text-lg font-bold text-[#FFF5F5] mb-1">{user.name}</h3>
              <p className="text-xs text-[#FFF5F5]/60 font-mono mb-4">{user.email}</p>

              <div className="grid grid-cols-3 gap-2.5 p-3 rounded-xl bg-[#18191B] border border-[#393B3F] text-left mb-6 font-mono text-[11px]">
                <div>
                  <div className="text-[10px] uppercase text-[#F7D7D1]">Plan Tier</div>
                  <div className="font-bold text-[#FFF5F5] uppercase">{user.tier}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-[#F7D7D1]">Prompts/Day</div>
                  <div className="font-bold text-[#FFF5F5]">{user.quota?.promptsPerDay || 100}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-[#F7D7D1]">Render Min</div>
                  <div className="font-bold text-[#FFF5F5]">{user.quota?.renderMinutes || 60}m</div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={onEnterStudio}
                  className="flex-1 py-3 px-4 bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-sm flex items-center justify-center space-x-2"
                >
                  <span>Open Studio Workspace</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={logout}
                  className="py-3 px-4 bg-[#2A2C2F] hover:bg-[#34373B] text-[#FFF5F5]/70 hover:text-red-400 border border-[#393B3F] font-semibold text-xs rounded-xl transition-colors flex items-center justify-center space-x-1.5"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          ) : (
            /* Auth Form (Tabs: Sign In / Create Account) */
            <div className="p-6 sm:p-8 rounded-2xl bg-[#222326] border border-[#393B3F] shadow-2xl relative">
              {/* Tab Switcher */}
              <div className="grid grid-cols-2 p-1 bg-[#18191B] border border-[#393B3F] rounded-xl mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setInlineMode('login');
                    setInlineError(null);
                    clearError();
                  }}
                  className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                    inlineMode === 'login'
                      ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm font-bold'
                      : 'text-[#FFF5F5]/70 hover:text-[#FFF5F5]'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInlineMode('register');
                    setInlineError(null);
                    clearError();
                  }}
                  className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                    inlineMode === 'register'
                      ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm font-bold'
                      : 'text-[#FFF5F5]/70 hover:text-[#FFF5F5]'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {/* Error notification */}
              {(inlineError || error) && (
                <div className="mb-4 p-3 bg-red-950/40 border border-red-800/50 rounded-xl text-xs text-red-300 flex items-start space-x-2">
                  <span className="font-bold">Error:</span>
                  <span>{inlineError || error}</span>
                </div>
              )}

              {/* Inline Form */}
              <form onSubmit={handleInlineAuthSubmit} className="space-y-4">
                {inlineMode === 'register' && (
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

                {inlineMode === 'register' && (
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
                      <span>{inlineMode === 'login' ? 'Sign In to Studio' : 'Create Studio Account'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Security info */}
              <div className="mt-5 flex items-center justify-center space-x-2 text-[11px] font-mono text-[#FFF5F5]/50">
                <ShieldCheck className="w-3.5 h-3.5 text-[#E3B5BE]" />
                <span>Encrypted Salted Scrypt + RFC 7519 JWT Auth</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#393B3F]/70 py-8 sm:py-12 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-[#FFF5F5]/60 font-mono text-center md:text-left">
        <div className="flex items-center space-x-3">
          <div className="w-6 h-6 rounded bg-[#2A2C2F] border border-[#E3B5BE]/30 flex items-center justify-center text-[#E3B5BE]">
            <Clapperboard className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-[#FFF5F5]">AutoDirector Studio</span>
          <span>© {new Date().getFullYear()}</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 text-[11px] sm:text-xs">
          <span className="flex items-center space-x-1.5 text-[#F7D7D1]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E3B5BE]" />
            <span>Render Pipeline Online</span>
          </span>
          <span>RFC 7519 JWT Auth</span>
          <span>FFmpeg Native Engine</span>
        </div>
      </footer>
    </div>
  );
};
