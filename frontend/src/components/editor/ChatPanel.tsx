import React, { useState } from 'react';
import { Send, Sparkles, Loader2, Bot, User, CheckCircle2, Layers, ArrowRight } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { api } from '../../api/client';

export const ChatPanel: React.FC = () => {
  const { project, plan, setPlan, chat, addChatMessage, setChatPending, updateJob, setPreviewUrl } =
    useEditorStore();

  const [promptText, setPromptText] = useState('');
  const [activeJobProgress, setActiveJobProgress] = useState<{
    jobId: string;
    percent: number;
    state: string;
  } | null>(null);

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

    try {
      // 1. Submit natural language prompt to AI planner
      const result = await api.submitPrompt(project.id, {
        prompt: finalPrompt,
        baseVersion: plan.version,
        requestPreview: true,
      });

      // 2. Update store with new plan version (single source of truth)
      setPlan(result.plan);

      const assistantMsg =
        (result as any).rationale ||
        `Created EditPlan v${result.version}. Configured ${result.plan.layers.length} active layers.`;

      addChatMessage({
        role: 'assistant',
        text: assistantMsg,
        planVersion: result.version,
      });

      // 3. If preview job enqueued, listen to SSE progress
      if (result.previewJobId) {
        const jobId = result.previewJobId;
        setActiveJobProgress({ jobId, percent: 0, state: 'queued' });

        const unsubscribe = api.subscribeToJobEvents(
          jobId,
          (event) => {
            const pct = typeof event.percent === 'number' ? event.percent : 0;
            setActiveJobProgress({
              jobId,
              percent: pct,
              state: event.state,
            });

            updateJob(jobId, {
              percent: pct,
              state: event.state,
            });

            if (event.state === 'done') {
              // Retrieve expiring preview download URL
              api.getJobDownloadUrl(jobId).then((res) => {
                setPreviewUrl(res.url, result.version);
              });

              setTimeout(() => {
                setActiveJobProgress(null);
                unsubscribe();
              }, 2500);
            } else if (event.state === 'failed') {
              setTimeout(() => {
                setActiveJobProgress(null);
                unsubscribe();
              }, 4000);
            }
          },
          (err) => {
            console.error('SSE subscription error:', err);
            setActiveJobProgress(null);
          }
        );
      }
    } catch (err: any) {
      console.error('Prompt submission error:', err);
      addChatMessage({
        role: 'assistant',
        text: `Sorry, I encountered an issue updating the plan: ${err.message}`,
      });
    } finally {
      setChatPending(false);
    }
  };

  return (
    <aside className="w-80 border-l border-surfaceBorder bg-surface flex flex-col h-full select-none text-xs">
      {/* Header */}
      <div className="h-12 border-b border-surfaceBorder px-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-blue-500" />
          <h2 className="text-xs font-semibold text-slate-100 uppercase tracking-wider">
            AI Director
          </h2>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium font-mono">
          Gemini 1.5 Pro
        </span>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {chat.messages.length === 0 && (
          <div className="text-center py-6 text-slate-400">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-2 text-blue-400 shadow-sm">
              <Bot className="w-5 h-5" />
            </div>
            <p className="font-semibold text-slate-200">AutoDirector AI</p>
            <p className="mt-1 text-slate-400 text-[11px] leading-relaxed max-w-[220px] mx-auto">
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
                  ? 'bg-blue-600 text-white shadow-blue-600/10'
                  : 'bg-[#0B0F17] border border-surfaceBorder text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between space-x-2 mb-1.5 opacity-60 text-[10px]">
                <div className="flex items-center space-x-1">
                  {m.role === 'user' ? (
                    <User className="w-3 h-3" />
                  ) : (
                    <Bot className="w-3 h-3 text-blue-400" />
                  )}
                  <span>{m.role === 'user' ? 'You' : 'AutoDirector'}</span>
                </div>
                <span>{m.timestamp}</span>
              </div>

              <p className="whitespace-pre-wrap">{m.text}</p>

              {m.planVersion && (
                <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-blue-300 font-mono">
                  <span className="flex items-center space-x-1">
                    <Layers className="w-3 h-3" />
                    <span>Plan updated</span>
                  </span>
                  <span className="bg-blue-500/20 px-1.5 py-0.5 rounded border border-blue-400/30">
                    v{m.planVersion}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* AI Planning Spinner */}
        {chat.pending && (
          <div className="flex items-center space-x-2.5 text-xs text-blue-400 p-3 rounded-xl bg-blue-500/5 border border-blue-500/15">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            <div className="space-y-0.5">
              <p className="font-semibold text-blue-300 text-[11px]">Generating EditPlan</p>
              <p className="text-[10px] text-blue-400/80">
                Parsing natural language & optimizing layers...
              </p>
            </div>
          </div>
        )}

        {/* SSE Preview Render Progress Card */}
        {activeJobProgress && (
          <div className="p-3 rounded-xl bg-[#0B0F17] border border-surfaceBorder space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300 font-medium flex items-center space-x-1.5">
                {activeJobProgress.state === 'done' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                )}
                <span>
                  {activeJobProgress.state === 'done'
                    ? '480p Preview Ready'
                    : 'Rendering 480p Preview...'}
                </span>
              </span>
              <span className="font-mono text-slate-400">{activeJobProgress.percent}%</span>
            </div>

            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  activeJobProgress.state === 'done' ? 'bg-emerald-500' : 'bg-blue-500'
                }`}
                style={{ width: `${Math.max(5, activeJobProgress.percent)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Suggested Quick Edits */}
      <div className="p-3 border-t border-surfaceBorder/80 bg-[#070A10]/50 space-y-1.5">
        <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
          Suggested Edits
        </p>
        <div className="flex flex-col space-y-1">
          {quickPrompts.slice(0, 3).map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSendPrompt(prompt)}
              disabled={chat.pending}
              className="text-[11px] bg-surface hover:bg-slate-800/80 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg border border-surfaceBorder transition-all text-left flex items-center justify-between group disabled:opacity-40"
            >
              <span className="truncate">{prompt}</span>
              <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-blue-400 transition-colors ml-1 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {/* Prompt Input Area */}
      <div className="p-3 border-t border-surfaceBorder bg-surface">
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
            className="w-full bg-[#0B0F17] border border-surfaceBorder rounded-xl p-3 pr-10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none transition-colors"
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
            className="absolute bottom-3 right-3 p-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm"
            title="Send prompt (Enter)"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </aside>
  );
};
