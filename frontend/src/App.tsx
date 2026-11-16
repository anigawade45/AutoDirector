import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LandingPage } from './components/landing/LandingPage';
import { ProjectDashboard } from './components/dashboard/ProjectDashboard';
import { EditorHeader } from './components/editor/EditorHeader';
import { LeftSidebar } from './components/editor/LeftSidebar';
import { VideoPlayer } from './components/editor/VideoPlayer';
import { TimelineView } from './components/editor/TimelineView';
import { ChatPanel } from './components/editor/ChatPanel';
import { ProjectPanel } from './components/editor/ProjectPanel';
import { InspectorPanel } from './components/editor/InspectorPanel';
import { useEditorStore } from './stores/editorStore';
import { useAuthStore } from './stores/authStore';
import { api } from './api/client';
import { EditPlan } from '@ai-video/shared';
import { Loader2, Sparkles, Film, Sliders, FileText } from 'lucide-react';
import { ToastContainer } from './components/common/ToastContainer';
import { AuthStorage } from './utils/authStorage';

export interface RouteState {
  view: 'landing' | 'dashboard' | 'editor';
  projectId: string | null;
}

/**
 * Parses current window location pathname and hash to determine view and route parameters.
 * Supports HTML5 pushState (/projects/:id, /dashboard, /) and hash-based fallback (#/projects/:id).
 */
export function parseRoute(pathname: string, hash: string = ''): RouteState {
  const cleanHash = (hash || '').replace(/^#/, '');
  const target = cleanHash.startsWith('/') ? cleanHash : pathname || '/';

  const projectMatch = target.match(/^\/(?:projects|editor)\/([^/?#]+)/i);
  if (projectMatch && projectMatch[1]) {
    return { view: 'editor', projectId: decodeURIComponent(projectMatch[1]) };
  }

  if (target.startsWith('/dashboard')) {
    return { view: 'dashboard', projectId: null };
  }

  return { view: 'landing', projectId: null };
}

export const App: React.FC = () => {
  const { isAuthenticated, isInitialized, checkSession } = useAuthStore();
  const [mobileTab, setMobileTab] = useState<'chat' | 'timeline' | 'inspector' | 'project'>('chat');
  const [currentView, setCurrentView] = useState<'landing' | 'dashboard' | 'editor'>('landing');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { setProject, setPlan, setPreviewUrl } = useEditorStore();

  // Validate session on boot
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Synchronized browser navigation helper (HTML5 History API)
  const navigateTo = useCallback(
    (
      view: 'landing' | 'dashboard' | 'editor',
      projectId: string | null = null,
      replace = false
    ) => {
      setCurrentView(view);
      setSelectedProjectId(projectId);

      if (typeof window !== 'undefined' && window.history?.pushState) {
        let targetUrl = '/';
        if (view === 'editor' && projectId) {
          targetUrl = `/projects/${encodeURIComponent(projectId)}`;
        } else if (view === 'dashboard') {
          targetUrl = '/dashboard';
        }

        if (window.location.pathname !== targetUrl) {
          if (replace) {
            window.history.replaceState({ view, projectId }, '', targetUrl);
          } else {
            window.history.pushState({ view, projectId }, '', targetUrl);
          }
        }
      }
    },
    []
  );

  // Browser Back / Forward button navigation (popstate)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      const route = parseRoute(window.location.pathname, window.location.hash);
      const isAuthed = useAuthStore.getState().isAuthenticated;

      if (!isAuthed) {
        setCurrentView('landing');
        setSelectedProjectId(null);
      } else {
        if (route.view === 'editor' && route.projectId) {
          setCurrentView('editor');
          setSelectedProjectId(route.projectId);
        } else if (route.view === 'dashboard') {
          setCurrentView('dashboard');
          setSelectedProjectId(null);
        } else {
          setCurrentView('dashboard');
          setSelectedProjectId(null);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Strict Authentication Guard & Initial Deep-Link Resolution:
  // Only synchronizes view AFTER initial session verification has resolved (isInitialized === true)
  // Guarantees zero privileged-view flash or race condition if stored credentials are invalid or expired.
  useEffect(() => {
    if (!isInitialized) return;

    if (!isAuthenticated) {
      if (currentView !== 'landing') {
        navigateTo('landing', null, true);
      }
    } else {
      // Direct deep link or refresh resolution
      const initialRoute =
        typeof window !== 'undefined'
          ? parseRoute(window.location.pathname, window.location.hash)
          : { view: 'dashboard', projectId: null };

      if (initialRoute.view === 'editor' && initialRoute.projectId) {
        setCurrentView('editor');
        setSelectedProjectId(initialRoute.projectId);
      } else if (initialRoute.view === 'dashboard' || currentView === 'landing') {
        navigateTo('dashboard', null, true);
      }
    }
  }, [isInitialized, isAuthenticated, currentView, navigateTo]);

  // Query server project data with TanStack Query
  const { data: projectResponse, isLoading: isProjectLoading } = useQuery({
    queryKey: ['project', selectedProjectId],
    queryFn: () => api.getProject(selectedProjectId!),
    enabled: !!selectedProjectId,
  });

  // Handle live server project response
  useEffect(() => {
    if (!projectResponse) return;
    const project = projectResponse.project || projectResponse;
    setProject(project, projectResponse.analysisSummary);

    if (projectResponse.previewUrl) {
      setPreviewUrl(
        projectResponse.previewUrl,
        project.headVersion || 1,
        Boolean(projectResponse.isRenderedPreview),
        projectResponse.baseProxyUrl
      );
    }

    if (projectResponse.plan) {
      setPlan(projectResponse.plan);
    } else {
      const initialPlan: EditPlan = {
        schemaVersion: '1.0',
        projectId: project.publicId,
        baseAssetId: project.baseAssetId?.publicId || 'ast_base',
        version: project.headVersion || 1,
        parentVersion: null,
        global: {
          aspect: project.settings?.aspect || '16:9',
          fps: project.settings?.fps || 30,
          resolution: '1080p',
        },
        layers: [
          {
            id: 'lyr_c1',
            layer: 'color',
            enabled: true,
            timebase: 'global',
            params: {
              preset: 'cinematic',
              contrast: 1.15,
              saturation: 0.95,
              vignette: 0.25,
            },
          },
        ],
        meta: {
          prompt: 'Initial project setup',
          model: 'gemini-1.5-pro',
          createdAt: new Date().toISOString(),
        },
      };
      setPlan(initialPlan);
    }
  }, [projectResponse, setProject, setPlan, setPreviewUrl]);

  // Initial Session Verification Gate:
  // While actively validating a stored session with the backend, render an unprivileged dark luxury splash.
  // This guarantees zero privileged-view flash or race conditions if the stored token is invalid.
  if (!isInitialized) {
    return (
      <div className="flex flex-col h-screen w-screen bg-[#18191B] items-center justify-center text-[#FFF5F5] font-sans">
        <ToastContainer />
        <div className="relative w-12 h-12 flex items-center justify-center mb-4">
          <div className="absolute inset-0 rounded-full border-2 border-[#E3B5BE]/20 animate-ping" />
          <Loader2 className="w-8 h-8 text-[#E3B5BE] animate-spin" />
        </div>
        <p className="text-sm font-medium text-[#FFF5F5]/70 tracking-wide">
          Verifying AutoDirector Studio session...
        </p>
      </div>
    );
  }

  // Landing Page View
  if (currentView === 'landing') {
    return (
      <>
        <ToastContainer />
        <LandingPage onEnterStudio={() => navigateTo('dashboard')} />
      </>
    );
  }

  // Dashboard View (or when no project selected)
  if (currentView === 'dashboard' || !selectedProjectId) {
    return (
      <>
        <ToastContainer />
        <ProjectDashboard onSelectProject={(pid) => navigateTo('editor', pid)} />
      </>
    );
  }

  // Editor Loading State
  if (isProjectLoading) {
    return (
      <>
        <ToastContainer />
        <div className="flex flex-col h-screen w-screen bg-[#18191B] items-center justify-center text-[#FFF5F5]">
          <Loader2 className="w-8 h-8 text-[#E3B5BE] animate-spin mb-3" />
          <p className="text-sm font-medium text-[#FFF5F5]/80">Loading sequence & timeline...</p>
        </div>
      </>
    );
  }

  // Full Studio Editor View (Adaptive Mobile & Desktop Workspace)
  return (
    <>
      <ToastContainer />
      <div className="flex flex-col h-screen w-screen bg-[#18191B] overflow-hidden text-[#FFF5F5] font-sans">
        {/* Editor Header */}
        <EditorHeader onBack={() => navigateTo('dashboard')} />

        {/* Main Responsive Workspace */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Desktop Left Sidebar (Project & Inspector tabs) */}
          <div className="hidden lg:flex w-80 shrink-0 h-full overflow-hidden">
            <LeftSidebar />
          </div>

          {/* Center Workspace Area */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Video Player & Realtime Canvas */}
            <div className="h-[36vh] sm:h-[42vh] lg:h-auto lg:flex-1 min-h-0 flex flex-col overflow-hidden border-b lg:border-b-0 border-[#393B3F]">
              <VideoPlayer />
            </div>

            {/* Mobile Studio Switcher Navigation Tabs (visible on mobile / tablet < lg) */}
            <div className="lg:hidden flex items-center justify-around bg-[#18191B] border-b border-[#393B3F] px-1 py-1 shrink-0 z-30">
              <button
                onClick={() => setMobileTab('chat')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                  mobileTab === 'chat'
                    ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm font-bold'
                    : 'text-[#FFF5F5]/60 hover:text-[#FFF5F5]'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Director</span>
              </button>

              <button
                onClick={() => setMobileTab('timeline')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                  mobileTab === 'timeline'
                    ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm font-bold'
                    : 'text-[#FFF5F5]/60 hover:text-[#FFF5F5]'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>Timeline</span>
              </button>

              <button
                onClick={() => setMobileTab('inspector')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                  mobileTab === 'inspector'
                    ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm font-bold'
                    : 'text-[#FFF5F5]/60 hover:text-[#FFF5F5]'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Inspector</span>
              </button>

              <button
                onClick={() => setMobileTab('project')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                  mobileTab === 'project'
                    ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm font-bold'
                    : 'text-[#FFF5F5]/60 hover:text-[#FFF5F5]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Media</span>
              </button>
            </div>

            {/* Mobile Active Content Panel (visible on mobile / tablet < lg) */}
            <div className="lg:hidden flex-1 min-h-0 overflow-hidden flex flex-col bg-[#1C1D1F]">
              {mobileTab === 'chat' && <ChatPanel />}
              {mobileTab === 'timeline' && <TimelineView />}
              {mobileTab === 'inspector' && <InspectorPanel />}
              {mobileTab === 'project' && <ProjectPanel />}
            </div>

            {/* Desktop Multi-Track Timeline (visible on desktop >= lg) */}
            <div className="hidden lg:block h-56 shrink-0">
              <TimelineView />
            </div>
          </div>

          {/* Desktop Right AI Director Chat & Suggestions */}
          <div className="hidden lg:flex w-80 shrink-0 h-full overflow-hidden">
            <ChatPanel />
          </div>
        </div>
      </div>
    </>
  );
};

export default App;
