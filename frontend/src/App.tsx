import React, { useState, useEffect } from 'react';
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

export const App: React.FC = () => {
  const { isAuthenticated, checkSession } = useAuthStore();
  const [mobileTab, setMobileTab] = useState<'chat' | 'timeline' | 'inspector' | 'project'>('chat');
  const [currentView, setCurrentView] = useState<'landing' | 'dashboard' | 'editor'>(() => {
    // If auth token exists in localStorage, default to dashboard, otherwise landing
    if (typeof window !== 'undefined' && localStorage.getItem('auth_token')) {
      return 'dashboard';
    }
    return 'landing';
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { setProject, setPlan, setPreviewUrl } = useEditorStore();

  // Validate session on boot
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Strict Authentication Guard & Navigation Sync:
  // 1. If not authenticated, user cannot access dashboard or video editor.
  // 2. If authenticated, user is automatically directed to Studio Dashboard instead of marketing landing page.
  useEffect(() => {
    if (!isAuthenticated) {
      if (currentView !== 'landing') {
        setCurrentView('landing');
        setSelectedProjectId(null);
      }
    } else {
      if (currentView === 'landing') {
        setCurrentView('dashboard');
      }
    }
  }, [isAuthenticated, currentView]);

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

  // Landing Page View
  if (currentView === 'landing') {
    return (
      <>
        <ToastContainer />
        <LandingPage onEnterStudio={() => setCurrentView('dashboard')} />
      </>
    );
  }

  // Dashboard View (or when no project selected)
  if (currentView === 'dashboard' || !selectedProjectId) {
    return (
      <>
        <ToastContainer />
        <ProjectDashboard
          onSelectProject={(pid) => {
            setSelectedProjectId(pid);
            setCurrentView('editor');
          }}
        />
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
      <EditorHeader
        onBack={() => {
          setSelectedProjectId(null);
          setCurrentView('dashboard');
        }}
      />

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
