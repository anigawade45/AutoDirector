import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Clapperboard,
  Loader2,
  Bot,
  User,
  CheckCircle2,
  Layers,
  ArrowRight,
  ChevronDown,
  Check,
  Cpu,
} from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { api } from '../../api/client';
import { AVAILABLE_GEMINI_MODELS } from '@ai-video/shared';
import { toast } from '../../stores/toastStore';

export const ChatPanel: React.FC = () => {
  const {
    project,
    plan,
    setPlan,
    chat,
    addChatMessage,
    setChatMessages,
    setChatPending,
    updateJob,
    setPreviewUrl,
    selectedAiModel,
    setSelectedAiModel,
  } = useEditorStore();

  const [promptText, setPromptText] = useState('');
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [activeJobProgress, setActiveJobProgress] = useState<{
    jobId: string;
    percent: number;
    state: string;
  } | null>(null);

  // Load project-scoped chat history whenever the active project changes
  useEffect(() => {
    if (!project?.id) return;

    let isMounted = true;
    api
      .getChatHistory(project.id)
      .then((res: any) => {
        if (!isMounted) return;
        const msgs = res?.data?.messages || res?.messages || [];
        if (Array.isArray(msgs)) {
          setChatMessages(
            msgs.map((m: any) => ({
              id: m.id || m._id || Math.random().toString(36).substring(2, 9),
              role: m.role || 'user',
              text: m.text,
              planVersion: m.planVersion || m.versionResult,
              timestamp:
                m.timestamp ||
                (m.createdAt
                  ? new Date(m.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
            }))
          );
        }
      })
      .catch((err) => {
        console.warn('[ChatPanel] Could not fetch chat history for project:', err?.message);
      });

    return () => {
      isMounted = false;
    };
  }, [project?.id]);

  // Auto-scroll to bottom of chat when messages update or pending
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages.length, chat.pending]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    if (isModelMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isModelMenuOpen]);

  const activeModel =
    AVAILABLE_GEMINI_MODELS.find((m) => m.id === selectedAiModel) || AVAILABLE_GEMINI_MODELS[0];

  const quickPrompts = [
    'Make it cinematic with teal & orange color grade',
    'Remove all silent pauses longer than 0.6s',
    'Add animated word-pop subtitles with yellow highlights',
    'Add upbeat background music with speech ducking',
    'Make subtitles bigger and positioned at top',
  ];

  const handleSendPrompt = async (textToSend?: string) => {
    const finalPrompt = textToSend || promptText;
    if (!finalPrompt.trim() || !project) return;

    setPromptText('');
    addChatMessage({ role: 'user', text: finalPrompt });
    setChatPending(true);
    toast.info('Director is compiling timeline plan...', 'Compiling Plan');

    try {
      let activeBaseVersion = plan.version;

      // If user had undone to an earlier version (plan.version < project.headVersion),
      // we must formally revert the server state to that undone version before applying the new prompt.
      // This guarantees the AI builds on top of the undone version (without the unwanted cuts),
      // rather than accidentally building on top of the undone changes!
      if (
        project.headVersion !== undefined &&
        project.headVersion !== null &&
        plan.version < project.headVersion
      ) {
        try {
          console.info(
            `[ChatPanel] Reverting server head from v${project.headVersion} to undone plan v${plan.version}...`
          );
          const revertRes = await api.revertPlan(project.id, plan.version);
          if (revertRes && revertRes.version) {
            activeBaseVersion = revertRes.version;
            if (revertRes.plan) {
              setPlan(revertRes.plan);
            }
          }
        } catch (revertErr) {
          console.warn('[ChatPanel] Pre-prompt revert notice:', revertErr);
        }
      }

      // 1. Submit natural language prompt to AI planner
      let result: any;
      try {
        result = await api.submitPrompt(project.id, {
          prompt: finalPrompt,
          baseVersion: activeBaseVersion,
          requestPreview: true,
          model: selectedAiModel,
        });
      } catch (submitErr: any) {
        // If stale base version conflict (HTTP 409), auto-sync with server's latest head plan and retry
        if (
          submitErr.message?.includes('stale') ||
          submitErr.message?.includes('version') ||
          submitErr.status === 409 ||
          submitErr.statusCode === 409
        ) {
          console.warn('[ChatPanel] Version conflict detected, auto-syncing with server head...');
          const refreshed = await api.getProject(project.id);
          if (refreshed.plan) {
            setPlan(refreshed.plan);
          }
          const serverHeadVersion =
            refreshed.project?.headVersion ?? refreshed.plan?.version ?? undefined;
          result = await api.submitPrompt(project.id, {
            prompt: finalPrompt,
            baseVersion: serverHeadVersion,
            requestPreview: true,
            model: selectedAiModel,
          });
        } else {
          throw submitErr;
        }
      }

      // 2. Update store with new plan version (single source of truth)
      setPlan(result.plan);

      const usedModel = result.plan.meta?.model;
      const modelSwitched = Boolean(usedModel && usedModel !== selectedAiModel);

      // Automatically update the UI model selector to match the model that succeeded
      if (modelSwitched && usedModel) {
        const matchedModel = AVAILABLE_GEMINI_MODELS.find((m) => m.id === usedModel);
        if (matchedModel) {
          setSelectedAiModel(usedModel);
        }
      }

      const prevModelObj = AVAILABLE_GEMINI_MODELS.find((m) => m.id === selectedAiModel);
      const activeModelObj = AVAILABLE_GEMINI_MODELS.find((m) => m.id === usedModel);
      const modelDisplayName = activeModelObj?.name || usedModel || 'AI Planner';
      const prevDisplayName = prevModelObj?.name || selectedAiModel;

      const assistantMsg =
        (result as any).rationale ||
        (modelSwitched
          ? `Created EditPlan v${result.version} using ${modelDisplayName} (auto-switched from ${prevDisplayName} due to high Google API traffic). Configured ${result.plan.layers.length} active layers.`
          : `Created EditPlan v${result.version}. Configured ${result.plan.layers.length} active layers.`);

      addChatMessage({
        role: 'assistant',
        text: assistantMsg,
        planVersion: result.version,
      });

      toast.success(
        `Applied Plan v${result.version}: ${result.plan.layers?.length || 0} active layers`,
        'Director Cut Applied'
      );
      if (modelSwitched) {
        toast.info(
          `Switched to ${modelDisplayName} for optimal response speed`,
          'Model Adjusted'
        );
      }

      // 3. If preview job enqueued, listen to SSE progress
      if (result.previewJobId) {
        const jobId = result.previewJobId;
        setActiveJobProgress({ jobId, percent: 0, state: 'queued' });

        const unsubscribe = api.subscribeToJobEvents(
          jobId,
          (event) => {
            const isDone = event.state === 'done' || event.state === 'completed';
            const isFailed = event.state === 'failed';
            const pct = isDone ? 100 : typeof event.percent === 'number' ? event.percent : 0;

            setActiveJobProgress({
              jobId,
              percent: pct,
              state: isDone ? 'done' : event.state,
            });

            updateJob(jobId, {
              percent: pct,
              state: isDone ? 'done' : event.state,
            });

            if (isDone) {
              toast.success(`Preview rendered for v${result.version}`, 'Timeline Preview Ready');
              // Retrieve expiring preview download URL
              api.getJobDownloadUrl(jobId).then((res) => {
                setPreviewUrl(res.url, result.version, true);
              });

              setTimeout(() => {
                setActiveJobProgress(null);
                unsubscribe();
              }, 2500);
            } else if (isFailed) {
              toast.warning(
                'Draft preview render failed, but EditPlan was applied',
                'Preview Warning'
              );
              setTimeout(() => {
                setActiveJobProgress(null);
                unsubscribe();
              }, 4000);
            }
          },
          (err) => {
            console.error('SSE subscription error:', err);
          }
        );
      }
    } catch (err: any) {
      console.error('Prompt submission error:', err);
      toast.error(err.message || 'AI Director could not compile plan', 'Director Error');
      addChatMessage({
        role: 'assistant',
        text: `Sorry, I encountered an issue updating the plan: ${err.message}`,
      });
    } finally {
      setChatPending(false);
    }
  };

  return (
    <aside className="w-full lg:w-80 border-l-0 lg:border-l border-[#393B3F] bg-[#18191B] flex flex-col h-full select-none text-xs font-sans min-h-0">
      {/* Header */}
      <div className="h-12 border-b border-[#393B3F] px-4 flex items-center justify-between relative bg-[#18191B]">
        <div className="flex items-center space-x-2">
          <Clapperboard className="w-4 h-4 text-[#E3B5BE]" />
          <h2 className="text-xs font-bold text-[#FFF5F5] uppercase tracking-wider">
            AI Director
          </h2>
        </div>

        {/* Gemini Model Selector Dropdown */}
        <div ref={modelMenuRef} className="relative">
          <button
            onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-[#2A2C2F] hover:bg-[#34373B] text-[#F7D7D1] border border-[#393B3F] text-[10px] font-mono transition-colors shadow-sm"
            title="Switch Gemini AI Model"
          >
            <Cpu className="w-3 h-3 text-[#E3B5BE]" />
            <span className="font-semibold">{activeModel.name.replace('Gemini ', '')}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${isModelMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isModelMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-[#222326] border border-[#393B3F] rounded-xl shadow-2xl z-50 p-2 space-y-1.5 text-xs backdrop-blur-md">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[#FFF5F5]/60 font-semibold border-b border-[#393B3F] flex items-center justify-between font-mono">
                <span>Director Models</span>
                <span className="text-[9px] text-[#F7D7D1]">{AVAILABLE_GEMINI_MODELS.length} Available</span>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {AVAILABLE_GEMINI_MODELS.map((model) => {
                  const isSelected = model.id === selectedAiModel;
                  return (
                    <button
                      key={model.id}
                      onClick={() => {
                        setSelectedAiModel(model.id);
                        setIsModelMenuOpen(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg transition-all flex items-start justify-between space-x-2 border ${
                        isSelected
                          ? 'bg-[#E3B5BE]/15 border-[#E3B5BE] text-[#F7D7D1] shadow-sm'
                          : 'bg-[#18191B] hover:bg-[#2A2C2F] text-[#FFF5F5]/70 border-transparent'
                      }`}
                    >
                      <div className="space-y-0.5 flex-1 min-w-0">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-semibold text-[11px] truncate">{model.name}</span>
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                              isSelected
                                ? 'bg-[#E3B5BE]/30 text-[#FFF5F5] border border-[#E3B5BE]/40'
                                : 'bg-[#2A2C2F] text-[#FFF5F5]/50 border border-[#393B3F]'
                            }`}
                          >
                            {model.tag}
                          </span>
                        </div>
                        <p className="text-[10px] text-[#FFF5F5]/50 leading-tight">
                          {model.description}
                        </p>
                      </div>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-[#E3B5BE] flex-shrink-0 mt-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#1C1D1F]">
        {chat.messages.length === 0 && (
          <div className="text-center py-6 text-[#FFF5F5]/50">
            <div className="w-10 h-10 rounded-2xl bg-[#2A2C2F] border border-[#393B3F] flex items-center justify-center mx-auto mb-2 text-[#E3B5BE] shadow-sm">
              <Bot className="w-5 h-5" />
            </div>
            <p className="font-semibold text-[#FFF5F5]">AutoDirector Studio</p>
            <p className="mt-1 text-[#FFF5F5]/60 text-[11px] leading-relaxed max-w-[220px] mx-auto">
              Direct the edit using plain English or select a suggested prompt below.
            </p>
          </div>
        )}

        {chat.messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[92%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed shadow-sm ${
                m.role === 'user'
                  ? 'bg-[#E3B5BE] text-[#18191B] font-semibold'
                  : 'bg-[#222326] border border-[#393B3F] text-[#FFF5F5]'
              }`}
            >
              <div className="flex items-center justify-between space-x-2 mb-1.5 opacity-60 text-[10px]">
                <div className="flex items-center space-x-1">
                  {m.role === 'user' ? (
                    <User className="w-3 h-3" />
                  ) : (
                    <Bot className="w-3 h-3 text-[#E3B5BE]" />
                  )}
                  <span>{m.role === 'user' ? 'You' : 'AutoDirector'}</span>
                </div>
                <span>{m.timestamp}</span>
              </div>

              <p className="whitespace-pre-wrap">{m.text}</p>

              {m.planVersion && (
                <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-[#F7D7D1] font-mono">
                  <span className="flex items-center space-x-1">
                    <Layers className="w-3 h-3 text-[#E3B5BE]" />
                    <span>Plan updated</span>
                  </span>
                  <span className="bg-[#2A2C2F] px-1.5 py-0.5 rounded border border-[#393B3F]">
                    v{m.planVersion}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* AI Planning Spinner */}
        {chat.pending && (
          <div className="flex items-center space-x-2.5 text-xs text-[#E3B5BE] p-3 rounded-xl bg-[#2A2C2F]/50 border border-[#393B3F]">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-[#E3B5BE]" />
            <div className="space-y-0.5">
              <p className="font-semibold text-[#F7D7D1] text-[11px]">Generating EditPlan</p>
              <p className="text-[10px] text-[#FFF5F5]/60">
                Parsing creative intent & optimizing timeline...
              </p>
            </div>
          </div>
        )}

        {/* SSE Preview Render Progress Card */}
        {activeJobProgress && (
          <div className="p-3 rounded-xl bg-[#222326] border border-[#393B3F] space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#FFF5F5] font-medium flex items-center space-x-1.5">
                {activeJobProgress.state === 'done' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#E3B5BE]" />
                ) : (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E3B5BE]" />
                )}
                <span>
                  {activeJobProgress.state === 'done'
                    ? '480p Preview Ready'
                    : 'Rendering 480p Preview...'}
                </span>
              </span>
              <span className="font-mono text-[#F7D7D1]">{activeJobProgress.percent}%</span>
            </div>

            <div className="w-full bg-[#18191B] rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  activeJobProgress.state === 'done' ? 'bg-[#E3B5BE]' : 'bg-[#F7D7D1]'
                }`}
                style={{ width: `${Math.max(5, activeJobProgress.percent)}%` }}
              />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Edits */}
      <div className="p-3 border-t border-[#393B3F] bg-[#18191B] space-y-1.5">
        <p className="text-[10px] text-[#FFF5F5]/50 font-mono font-semibold uppercase tracking-wider">
          Suggested Edits
        </p>
        <div className="flex flex-col space-y-1">
          {quickPrompts.slice(0, 3).map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSendPrompt(prompt)}
              disabled={chat.pending}
              className="text-[11px] bg-[#222326] hover:bg-[#2A2C2F] text-[#FFF5F5]/80 hover:text-[#FFF5F5] px-2.5 py-1.5 rounded-lg border border-[#393B3F] transition-all text-left flex items-center justify-between group disabled:opacity-40"
            >
              <span className="truncate">{prompt}</span>
              <ArrowRight className="w-3 h-3 text-[#FFF5F5]/40 group-hover:text-[#E3B5BE] transition-colors ml-1 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {/* Prompt Input Area */}
      <div className="p-3 border-t border-[#393B3F] bg-[#18191B]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendPrompt();
          }}
          className="relative"
        >
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            disabled={chat.pending}
            placeholder="Instruct AutoDirector: 'Make it fast paced with upbeat music'..."
            rows={2}
            className="w-full bg-[#121314] border border-[#393B3F] rounded-xl p-3 pr-10 text-xs text-[#FFF5F5] placeholder:text-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE] resize-none transition-colors"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendPrompt();
              }
            }}
          />
          <button
            type="submit"
            disabled={!promptText.trim() || chat.pending}
            className="absolute bottom-3 right-3 p-1.5 rounded-lg bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm font-bold"
            title="Send prompt (Enter)"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </aside>
  );
};
