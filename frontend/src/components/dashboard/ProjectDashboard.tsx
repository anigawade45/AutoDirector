import React, { useState } from 'react';
import {
  Plus,
  Video,
  Clock,
  Film,
  Sparkles,
  ArrowRight,
  Trash2,
  Loader2,
  Layers,
  Pencil,
  Archive,
  ArchiveRestore,
  Inbox,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { UploadModal } from './UploadModal';
import { EditProjectModal } from './EditProjectModal';

interface ProjectDashboardProps {
  onSelectProject: (projectId: string) => void;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({ onSelectProject }) => {
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any | null>(null);
  const [filterTab, setFilterTab] = useState<'active' | 'archived'>('active');
  const queryClient = useQueryClient();

  const {
    data: projects = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['projects', filterTab],
    queryFn: () => api.listProjects(filterTab),
    refetchInterval: 5000,
  });

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => api.deleteProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (projectId: string) => api.archiveProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: (projectId: string) => api.unarchiveProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const handleDelete = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this project?')) {
      deleteMutation.mutate(projectId);
    }
  };

  const handleArchive = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    archiveMutation.mutate(projectId);
  };

  const handleUnarchive = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    unarchiveMutation.mutate(projectId);
  };

  const handleEdit = (e: React.MouseEvent, project: any) => {
    e.stopPropagation();
    setEditingProject(project);
  };

  const demoProjects = [
    {
      publicId: 'prj_demo_goa',
      title: 'My Trip to Goa (Interactive Demo)',
      status: 'ready',
      updatedAt: new Date().toISOString(),
      settings: { aspect: '16:9', fps: 30, width: 1920, height: 1080, language: 'en' },
      isDemo: true,
    },
  ];

  const displayProjects =
    projects.length > 0 ? projects : filterTab === 'active' ? demoProjects : [];

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="h-16 border-b border-surfaceBorder px-8 flex items-center justify-between bg-surface/50 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Film className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              AutoDirector AI
            </span>
            <span className="text-xs px-2 py-0.5 ml-2 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
              MVP v1.0
            </span>
          </div>
        </div>

        <button
          onClick={() => setIsUploadOpen(true)}
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 transition-colors px-4 py-2 rounded-lg text-sm font-semibold shadow-md shadow-blue-600/20"
        >
          <Plus className="w-4 h-4" />
          <span>New Video Project</span>
        </button>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-8">
        {/* Hero Section */}
        <div className="mb-10 bg-gradient-to-r from-blue-950/40 via-indigo-950/20 to-transparent border border-blue-800/20 rounded-2xl p-8 relative overflow-hidden">
          <div className="max-w-2xl relative z-10">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-medium mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI-First Video Creation & Editing</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight mb-3">
              Transform raw footage with natural language prompts
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">
              Deterministic 5-pass FFmpeg rendering, Whisper word-level subtitle sync, intelligent
              silence cuts, and reversible version trees. Describe your creative intent and let the
              AI edit your project.
            </p>
            <button
              onClick={() => setIsUploadOpen(true)}
              className="inline-flex items-center space-x-2 bg-slate-100 hover:bg-white text-slate-900 font-semibold text-sm px-5 py-2.5 rounded-xl shadow-lg transition-transform active:scale-95"
            >
              <span>Upload Video & Start Editing</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Project Header & Filter Tabs */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-surfaceBorder/80 pb-4">
          <div className="flex items-center space-x-4">
            <h2 className="text-xl font-bold tracking-tight">Project Library</h2>
            <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-surfaceBorder text-xs">
              <button
                onClick={() => setFilterTab('active')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center space-x-1.5 ${
                  filterTab === 'active'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>Active Projects</span>
              </button>

              <button
                onClick={() => setFilterTab('archived')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center space-x-1.5 ${
                  filterTab === 'archived'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Archived</span>
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs text-slate-400">
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
            <span>
              {displayProjects.length} {filterTab === 'archived' ? 'archived' : 'active'} project(s)
            </span>
          </div>
        </div>

        {/* Projects View */}
        {isLoading && projects.length === 0 ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl">
            Failed to load projects from API server.
          </div>
        ) : displayProjects.length === 0 ? (
          <div className="p-16 text-center border border-dashed border-surfaceBorder rounded-2xl bg-surface/30 flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-surfaceBorder flex items-center justify-center text-slate-500 mb-4">
              <Inbox className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-slate-200 mb-1">
              {filterTab === 'archived' ? 'No Archived Projects' : 'No Projects Found'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mb-6">
              {filterTab === 'archived'
                ? 'Projects you archive from your active library will be safely stored here.'
                : 'Upload your first raw video footage to begin AI-native video editing.'}
            </p>
            {filterTab === 'active' && (
              <button
                onClick={() => setIsUploadOpen(true)}
                className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs px-4 py-2 rounded-xl transition-all shadow-md"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create New Video Project</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayProjects.map((project: any) => {
              const isArchived = project.status === 'archived';

              return (
                <div
                  key={project.publicId}
                  onClick={() => onSelectProject(project.publicId)}
                  className={`group cursor-pointer bg-surface/80 hover:bg-surface border rounded-xl overflow-hidden transition-all duration-200 hover:shadow-xl flex flex-col relative ${
                    isArchived
                      ? 'border-amber-900/30 hover:border-amber-500/40 opacity-90'
                      : 'border-surfaceBorder hover:border-blue-500/50 hover:shadow-blue-500/5'
                  }`}
                >
                  {/* Thumbnail area */}
                  <div className="h-44 bg-slate-900/80 relative flex items-center justify-center border-b border-surfaceBorder overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10" />
                    <Video
                      className={`w-12 h-12 transition-all duration-300 ${
                        isArchived
                          ? 'text-amber-700/60'
                          : 'text-slate-700 group-hover:scale-110 group-hover:text-blue-500'
                      }`}
                    />

                    {/* Aspect & FPS Tag */}
                    <span className="absolute bottom-3 right-3 z-20 text-[11px] px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm text-slate-300 font-mono">
                      {project.settings?.aspect || '16:9'} • {project.settings?.fps || 30}fps
                    </span>

                    {/* Status Badge */}
                    <span
                      className={`absolute top-3 left-3 z-20 text-xs px-2.5 py-0.5 rounded-full font-medium capitalize border ${
                        isArchived
                          ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                          : project.status === 'ready'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : project.status === 'analyzing'
                              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse'
                              : 'bg-slate-700/20 text-slate-300 border-slate-700/40'
                      }`}
                    >
                      {project.status || 'draft'}
                    </span>

                    {/* Action Bar (Top Right) */}
                    {!project.isDemo && (
                      <div className="absolute top-3 right-3 z-20 flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Edit / Rename Button */}
                        <button
                          onClick={(e) => handleEdit(e, project)}
                          className="p-1.5 rounded-lg bg-black/60 hover:bg-blue-600 text-slate-300 hover:text-white transition-colors"
                          title="Rename / Project Settings"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        {/* Archive / Unarchive Button */}
                        {isArchived ? (
                          <button
                            onClick={(e) => handleUnarchive(e, project.publicId)}
                            className="p-1.5 rounded-lg bg-black/60 hover:bg-emerald-600 text-slate-300 hover:text-white transition-colors"
                            title="Unarchive Project"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => handleArchive(e, project.publicId)}
                            className="p-1.5 rounded-lg bg-black/60 hover:bg-amber-600 text-slate-300 hover:text-white transition-colors"
                            title="Archive Project"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Delete Button */}
                        <button
                          onClick={(e) => handleDelete(e, project.publicId)}
                          className="p-1.5 rounded-lg bg-black/60 hover:bg-rose-600 text-slate-300 hover:text-white transition-colors"
                          title="Permanently Delete Project"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Details Area */}
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3
                          className={`font-semibold text-base transition-colors mb-1 line-clamp-1 ${
                            isArchived
                              ? 'text-slate-300 group-hover:text-amber-400'
                              : 'text-slate-100 group-hover:text-blue-400'
                          }`}
                        >
                          {project.title}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-400 flex items-center space-x-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>
                          {project.updatedAt
                            ? new Date(project.updatedAt).toLocaleDateString()
                            : 'Just now'}
                        </span>
                        {(project.baseAssetId?.media?.durationMs || project.stats?.durationMs) && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-[11px] text-blue-400">
                              {Math.round(
                                (project.baseAssetId?.media?.durationMs ||
                                  project.stats?.durationMs ||
                                  0) / 1000
                              )}
                              s
                            </span>
                          </>
                        )}
                        {project.settings?.language && (
                          <>
                            <span>•</span>
                            <span className="uppercase text-[10px] px-1 py-0.2 rounded bg-slate-800 text-slate-400">
                              {project.settings.language}
                            </span>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="mt-4 pt-4 border-t border-surfaceBorder flex items-center justify-between text-xs text-slate-400">
                      <span className="flex items-center space-x-1">
                        <Layers className="w-3.5 h-3.5" />
                        <span>
                          {isArchived
                            ? 'Archived (Read-Only)'
                            : project.isDemo
                              ? 'Demo Mode'
                              : 'Ready to Edit'}
                        </span>
                      </span>
                      <span
                        className={`font-medium group-hover:underline flex items-center space-x-1 ${
                          isArchived ? 'text-amber-400' : 'text-blue-400'
                        }`}
                      >
                        <span>{isArchived ? 'View Snapshot' : 'Open Editor'}</span>
                        <span>&rarr;</span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Upload Modal */}
      {isUploadOpen && (
        <UploadModal
          onClose={() => setIsUploadOpen(false)}
          onProjectCreated={(pid) => {
            setIsUploadOpen(false);
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            onSelectProject(pid);
          }}
        />
      )}

      {/* Edit Project Settings / Rename Modal */}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['projects'] });
          }}
        />
      )}
    </div>
  );
};
