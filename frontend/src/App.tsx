import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProjectDashboard } from './components/dashboard/ProjectDashboard';
import { EditorHeader } from './components/editor/EditorHeader';
import { LeftSidebar } from './components/editor/LeftSidebar';
import { VideoPlayer } from './components/editor/VideoPlayer';
import { TimelineView } from './components/editor/TimelineView';
import { ChatPanel } from './components/editor/ChatPanel';
import { useEditorStore } from './stores/editorStore';
import { api } from './api/client';
import { EditPlan } from '@ai-video/shared';
import { Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { setProject, setPlan, setPreviewUrl } = useEditorStore();

  // Query server project data with TanStack Query
  const { data: projectResponse, isLoading: isProjectLoading } = useQuery({
    queryKey: ['project', selectedProjectId],
    queryFn: () => api.getProject(selectedProjectId!),
    enabled: !!selectedProjectId && selectedProjectId !== 'prj_demo_goa',
  });

  // Handle live server project response
  useEffect(() => {
    if (!projectResponse) return;
    const project = projectResponse.project || projectResponse;
    setProject(project, projectResponse.analysisSummary);

    if (projectResponse.previewUrl) {
      setPreviewUrl(projectResponse.previewUrl, project.headVersion || 1);
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

  // Handle mock interactive demo project
  useEffect(() => {
    if (selectedProjectId !== 'prj_demo_goa') return;

    setProject(
      {
        publicId: 'prj_demo_goa',
        title: 'My Trip to Goa (Interactive Demo)',
        status: 'ready',
        baseAssetId: {
          publicId: 'ast_demo_01',
          media: { durationMs: 58400, width: 1920, height: 1080, fps: 30 },
        },
      },
      {
        durationMs: 58400,
        silencesCount: 4,
        sceneCutsCount: 7,
        bpm: 124,
        integratedLufs: -15.8,
        truePeakDb: -1.2,
        status: 'complete',
        cuesCount: 16,
        wordCount: 78,
        transcriptSnippet: 'Welcome to our vacation in Goa. Exploring the beaches and golden sunsets.',
        cues: [
          {
            startMs: 1200,
            endMs: 4500,
            text: 'Welcome to our vacation in Goa. Exploring the beaches and golden sunsets.',
            words: [
              { word: 'Welcome', startMs: 1200, endMs: 1600 },
              { word: 'to', startMs: 1650, endMs: 1800 },
              { word: 'our', startMs: 1850, endMs: 2000 },
              { word: 'vacation', startMs: 2050, endMs: 2600 },
              { word: 'in', startMs: 2650, endMs: 2800 },
              { word: 'Goa.', startMs: 2850, endMs: 3300 },
              { word: 'Exploring', startMs: 3400, endMs: 3900 },
              { word: 'the', startMs: 3950, endMs: 4100 },
              { word: 'beaches', startMs: 4150, endMs: 4500 },
            ],
          },
          {
            startMs: 5100,
            endMs: 9800,
            text: 'The waves crashing against the rocky cliffs created such a stunning peaceful atmosphere.',
            words: [
              { word: 'The', startMs: 5100, endMs: 5300 },
              { word: 'waves', startMs: 5350, endMs: 5700 },
              { word: 'crashing', startMs: 5750, endMs: 6200 },
              { word: 'against', startMs: 6250, endMs: 6600 },
              { word: 'the', startMs: 6650, endMs: 6800 },
              { word: 'rocky', startMs: 6850, endMs: 7200 },
              { word: 'cliffs', startMs: 7250, endMs: 7700 },
              { word: 'peaceful', startMs: 8400, endMs: 9100 },
              { word: 'atmosphere.', startMs: 9150, endMs: 9800 },
            ],
          },
          {
            startMs: 10500,
            endMs: 14200,
            text: 'Later in the evening, we stopped by the famous beach shacks for local seafood.',
            words: [
              { word: 'Later', startMs: 10500, endMs: 10900 },
              { word: 'in', startMs: 10950, endMs: 11100 },
              { word: 'the', startMs: 11150, endMs: 11300 },
              { word: 'evening,', startMs: 11350, endMs: 11800 },
              { word: 'we', startMs: 11850, endMs: 12000 },
              { word: 'stopped', startMs: 12050, endMs: 12450 },
              { word: 'by', startMs: 12500, endMs: 12650 },
              { word: 'local', startMs: 13300, endMs: 13700 },
              { word: 'seafood.', startMs: 13750, endMs: 14200 },
            ],
          },
        ],
      }
    );

    const initialPlan: EditPlan = {
      schemaVersion: '1.0',
      projectId: 'prj_demo_goa',
      baseAssetId: 'ast_demo_01',
      version: 1,
      parentVersion: null,
      global: {
        aspect: '16:9',
        fps: 30,
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
            saturation: 0.9,
            vignette: 0.3,
          },
        },
        {
          id: 'lyr_s1',
          layer: 'subtitle',
          enabled: true,
          timebase: 'source',
          params: {
            style: 'word_pop',
            font: 'Montserrat',
            size: 52,
            position: 'bottom',
            primaryColor: '#FFFFFF',
            highlightColor: '#FFD84D',
            maxWordsPerLine: 4,
          },
        },
        {
          id: 'lyr_m1',
          layer: 'music',
          enabled: true,
          timebase: 'output',
          params: {
            trackId: 'track_lofi_01',
            duckUnderSpeech: true,
            volume: 0.75,
          },
        },
      ],
      meta: {
        prompt: 'Initial plan',
        model: 'gemini-1.5-pro',
        createdAt: new Date().toISOString(),
      },
    };

    setPlan(initialPlan);
  }, [selectedProjectId, setProject, setPlan]);

  if (!selectedProjectId) {
    return <ProjectDashboard onSelectProject={(pid) => setSelectedProjectId(pid)} />;
  }

  if (isProjectLoading) {
    return (
      <div className="flex flex-col h-screen w-screen bg-[#0B0F17] items-center justify-center text-slate-100">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
        <p className="text-sm font-medium text-slate-300">Loading project & timeline...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0B0F17] overflow-hidden text-slate-100 font-sans">
      {/* Editor Header */}
      <EditorHeader onBack={() => setSelectedProjectId(null)} />

      {/* Main Workspace: Left Sidebar (Project / Inspector tabs) + Center Player + Right Chat */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Project Details & Inspector Controls */}
        <LeftSidebar />

        {/* Center: Video Player & Realtime Canvas */}
        <VideoPlayer />

        {/* Right: AI Director Chat & Suggestions */}
        <ChatPanel />
      </div>

      {/* Bottom: Multi-Track Timeline & Playhead */}
      <TimelineView />
    </div>
  );
};

export default App;
