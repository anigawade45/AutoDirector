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
  User as UserIcon,
  LogOut,
  Home,
  Shield,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useEditorStore } from '../../stores/editorStore';
import { toast } from '../../stores/toastStore';
import { AuthModal } from '../auth/AuthModal';
import { UploadModal } from './UploadModal';
import { EditProjectModal } from './EditProjectModal';
import { ConfirmModal } from '../common/ConfirmModal';

interface ProjectDashboardProps {
  onSelectProject: (projectId: string) => void;
  onBackToHome?: () => void;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
  onSelectProject,
  onBackToHome,
}) => {
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; title: string } | null>(
    null
  );
  const [filterTab, setFilterTab] = useState<'active' | 'archived'>('active');
  const queryClient = useQueryClient();
  const { user, isAuthenticated, logout } = useAuthStore();

  const {
    data: projects = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['projects', user?.id, filterTab],
    queryFn: () => api.listProjects(filterTab),
    enabled: !!user?.id,
    refetchInterval: 5000,
  });

  const handleLogout = () => {
    queryClient.clear();
    useEditorStore.getState().clearChat();
    logout();
  };

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => api.deleteProject(projectId),
    onSuccess: () => {
      setProjectToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project permanently deleted.', 'Project Removed');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to delete project.', 'Delete Error');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (projectId: string) => api.archiveProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.info('Project safely moved to archive library.', 'Project Archived');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to archive project.');
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: (projectId: string) => api.unarchiveProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project restored to active workspace library.', 'Project Restored');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to restore project.');
    },
  });

  const handleDelete = (e: React.MouseEvent, project: any) => {
    e.stopPropagation();
    setProjectToDelete({
      id: project.publicId,
      title: project.title || 'Untitled Project',
    });
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

  // Strict Multi-Tenant Isolation: users only see their own projects fetched from the database
  // Filter out incomplete draft projects that have not completed initial video upload (no baseAssetId)
  const displayProjects = projects.filter((project: any) => {
    if (project.isDemo) return true;
    if (project.status === 'draft' && !project.baseAssetId) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#18191B] text-[#FFF5F5] flex flex-col font-sans">
      {/* Top Navigation */}
      <header className="h-16 border-b border-[#393B3F] px-4 sm:px-8 flex items-center justify-between bg-[#18191B]/95 backdrop-blur-md">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <div className="flex items-center space-x-2.5 sm:space-x-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-[#2A2C2F] border border-[#E3B5BE]/30 flex items-center justify-center text-[#E3B5BE] shadow-sm shrink-0">
              <Film className="w-4 h-4 text-[#E3B5BE]" />
            </div>
            <div>
              <span className="font-bold text-sm sm:text-base tracking-tight text-[#FFF5F5]">
                AutoDirector Studio
              </span>
              <span className="hidden xs:inline-block text-[10px] font-mono px-2 py-0.5 ml-2 rounded-full bg-[#2A2C2F] text-[#F7D7D1] border border-[#393B3F]">
                Library
              </span>
            </div>
          </div>

          {onBackToHome && (
            <button
              onClick={onBackToHome}
              className="hidden sm:flex items-center space-x-1.5 text-xs text-[#FFF5F5]/70 hover:text-[#FFF5F5] px-2.5 py-1.5 rounded-lg hover:bg-[#2A2C2F] transition-colors border border-transparent hover:border-[#393B3F]"
              title="Return to Landing Page"
            >
              <Home className="w-3.5 h-3.5 text-[#E3B5BE]" />
              <span>Landing Page</span>
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            onClick={() => setIsUploadOpen(true)}
            className="flex items-center space-x-1.5 sm:space-x-2 bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] transition-colors px-3 sm:px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Video Project</span>
            <span className="sm:hidden">New Project</span>
          </button>

          {/* User Account Bar */}
          {isAuthenticated && user ? (
            <div className="flex items-center space-x-2 sm:space-x-2.5 pl-2 sm:pl-3 border-l border-[#393B3F]">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-[#2A2C2F] border border-[#E3B5BE]/40 text-[#E3B5BE] font-bold text-xs flex items-center justify-center shadow-inner">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="hidden md:block text-left">
                  <div className="text-xs font-semibold text-[#FFF5F5] leading-tight">
                    {user.name}
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] font-mono uppercase font-bold px-1.5 py-0.2 rounded bg-[#2A2C2F] text-[#F7D7D1] border border-[#393B3F]">
                      {user.tier}
                    </span>
                    <span className="text-[10px] text-[#FFF5F5]/50 font-mono">
                      {user.quota?.promptsPerDay ? `${user.quota.promptsPerDay} prompts/d` : ''}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 text-[#FFF5F5]/60 hover:text-red-400 hover:bg-[#2A2C2F] rounded-lg transition-colors"
                title="Log Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2 pl-2 sm:pl-3 border-l border-[#393B3F]">
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="flex items-center space-x-1.5 text-xs font-semibold text-[#FFF5F5] bg-[#2A2C2F] hover:bg-[#34373B] px-3 py-2 rounded-lg transition-colors border border-[#393B3F]"
              >
                <UserIcon className="w-3.5 h-3.5 text-[#E3B5BE]" />
                <span>Sign In</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 md:p-8">
        {/* Editorial Studio Banner */}
        <div className="mb-8 sm:mb-10 bg-[#222326] border border-[#393B3F] rounded-2xl p-5 sm:p-8 relative overflow-hidden">
          <div className="max-w-2xl relative z-10">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#2A2C2F] text-[#F7D7D1] text-xs font-mono mb-4 border border-[#393B3F]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E3B5BE]" />
              <span>Studio Workspace</span>
            </div>
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-[#FFF5F5] mb-2.5">
              Precision video editing with natural creative direction
            </h1>
            <p className="text-[#FFF5F5]/70 text-xs sm:text-sm leading-relaxed mb-6 font-normal">
              Deterministic multi-pass cloud rendering, kinetic word-level subtitle alignment,
              intelligent voice pause cuts, and non-destructive version trees.
            </p>
            <button
              onClick={() => setIsUploadOpen(true)}
              className="inline-flex items-center space-x-2 bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold text-xs uppercase tracking-wider px-4 sm:px-5 py-2.5 rounded-lg shadow-sm transition-transform active:scale-95"
            >
              <span>Upload Video & Open Workspace</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Project Header & Filter Tabs */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#393B3F] pb-4">
          <div className="flex items-center space-x-4">
            <h2 className="text-lg font-bold tracking-tight text-[#FFF5F5]">Project Library</h2>
            <div className="flex items-center bg-[#18191B] p-1 rounded-lg border border-[#393B3F] text-xs">
              <button
                onClick={() => setFilterTab('active')}
                className={`px-3 py-1.5 rounded-md font-semibold text-xs transition-all flex items-center space-x-1.5 ${
                  filterTab === 'active'
                    ? 'bg-[#E3B5BE] text-[#18191B] shadow-sm'
                    : 'text-[#FFF5F5]/60 hover:text-[#FFF5F5]'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>Active Projects</span>
              </button>

              <button
                onClick={() => setFilterTab('archived')}
                className={`px-3 py-1.5 rounded-md font-semibold text-xs transition-all flex items-center space-x-1.5 ${
                  filterTab === 'archived'
                    ? 'bg-[#2A2C2F] text-[#F7D7D1] shadow-sm'
                    : 'text-[#FFF5F5]/60 hover:text-[#FFF5F5]'
                }`}
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Archived</span>
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs font-mono text-[#FFF5F5]/60">
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E3B5BE]" />}
            <span>
              {displayProjects.length} {filterTab === 'archived' ? 'archived' : 'active'} project(s)
            </span>
          </div>
        </div>

        {/* Projects View */}
        {isLoading && projects.length === 0 ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#E3B5BE]" />
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-red-300 bg-red-950/30 border border-red-800/40 rounded-xl">
            Failed to load projects from API server.
          </div>
        ) : displayProjects.length === 0 ? (
          <div className="p-16 text-center border border-dashed border-[#393B3F] rounded-2xl bg-[#222326]/50 flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-[#18191B] border border-[#393B3F] flex items-center justify-center text-[#FFF5F5]/50 mb-4">
              <Inbox className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-[#FFF5F5] mb-1">
              {filterTab === 'archived' ? 'No Archived Projects' : 'No Projects Found'}
            </h3>
            <p className="text-xs text-[#FFF5F5]/60 max-w-sm mb-6">
              {filterTab === 'archived'
                ? 'Projects you archive from your active library will be safely stored here.'
                : 'Upload your first raw video footage to begin editing.'}
            </p>
            {filterTab === 'active' && (
              <button
                onClick={() => setIsUploadOpen(true)}
                className="inline-flex items-center space-x-2 bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold text-xs uppercase tracking-wider px-5 py-2.5 rounded-lg transition-all shadow-sm active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Your First Project</span>
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
                  className={`group cursor-pointer bg-[#222326] hover:bg-[#27292C] border rounded-xl overflow-hidden transition-all duration-200 hover:shadow-xl flex flex-col relative ${
                    isArchived
                      ? 'border-[#393B3F] opacity-80'
                      : 'border-[#393B3F] hover:border-[#E3B5BE]'
                  }`}
                >
                  {/* Thumbnail area */}
                  <div className="h-44 bg-[#18191B] relative flex items-center justify-center border-b border-[#393B3F] overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10" />
                    <Video
                      className={`w-12 h-12 transition-all duration-300 ${
                        isArchived
                          ? 'text-[#FFF5F5]/20'
                          : 'text-[#FFF5F5]/30 group-hover:scale-105 group-hover:text-[#E3B5BE]'
                      }`}
                    />

                    {/* Aspect & FPS Tag */}
                    <span className="absolute bottom-3 right-3 z-20 text-[11px] px-2 py-0.5 rounded bg-[#18191B]/80 backdrop-blur-sm text-[#FFF5F5]/80 font-mono border border-[#393B3F]">
                      {project.settings?.aspect || '16:9'} • {project.settings?.fps || 30}fps
                    </span>

                    {/* Status Badge */}
                    <span
                      className={`absolute top-3 left-3 z-20 text-[11px] font-mono px-2.5 py-0.5 rounded-full capitalize border ${
                        isArchived
                          ? 'bg-[#2A2C2F] text-[#FFF5F5]/60 border-[#393B3F]'
                          : project.status === 'ready'
                            ? 'bg-[#2A2C2F] text-[#F7D7D1] border-[#E3B5BE]/40'
                            : project.status === 'analyzing'
                              ? 'bg-[#2A2C2F] text-[#E3B5BE] border-[#E3B5BE]/60 animate-pulse'
                              : 'bg-[#2A2C2F] text-[#FFF5F5]/60 border-[#393B3F]'
                      }`}
                    >
                      {project.status || 'draft'}
                    </span>

                    {/* Action Bar (Top Right) */}
                    {!project.isDemo && (
                      <div className="absolute top-3 right-3 z-20 flex items-center space-x-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        {/* Edit / Rename Button */}
                        <button
                          onClick={(e) => handleEdit(e, project)}
                          className="p-1.5 rounded-lg bg-[#18191B]/90 hover:bg-[#E3B5BE] text-[#FFF5F5] hover:text-[#18191B] transition-colors border border-[#393B3F]"
                          title="Rename / Project Settings"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        {/* Archive / Unarchive Button */}
                        {isArchived ? (
                          <button
                            onClick={(e) => handleUnarchive(e, project.publicId)}
                            className="p-1.5 rounded-lg bg-[#18191B]/90 hover:bg-[#E3B5BE] text-[#FFF5F5] hover:text-[#18191B] transition-colors border border-[#393B3F]"
                            title="Unarchive Project"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => handleArchive(e, project.publicId)}
                            className="p-1.5 rounded-lg bg-[#18191B]/90 hover:bg-[#E3B5BE] text-[#FFF5F5] hover:text-[#18191B] transition-colors border border-[#393B3F]"
                            title="Archive Project"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Delete Button */}
                        <button
                          onClick={(e) => handleDelete(e, project)}
                          className="p-1.5 rounded-lg bg-[#18191B]/90 hover:bg-rose-700 text-[#FFF5F5] hover:text-white transition-colors border border-[#393B3F]"
                          title="Permanently Delete Project"
                          aria-label={`Delete project ${project.title}`}
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
                              ? 'text-[#FFF5F5]/70'
                              : 'text-[#FFF5F5] group-hover:text-[#E3B5BE]'
                          }`}
                        >
                          {project.title}
                        </h3>
                      </div>
                      <p className="text-xs text-[#FFF5F5]/60 flex items-center space-x-1.5 font-mono">
                        <Clock className="w-3.5 h-3.5 text-[#E3B5BE]" />
                        <span>
                          {project.updatedAt
                            ? new Date(project.updatedAt).toLocaleDateString()
                            : 'Just now'}
                        </span>
                        {(project.baseAssetId?.media?.durationMs || project.stats?.durationMs) && (
                          <>
                            <span>•</span>
                            <span className="text-[#F7D7D1]">
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
                            <span className="uppercase text-[10px] px-1.5 py-0.2 rounded bg-[#18191B] text-[#FFF5F5]/60 border border-[#393B3F]">
                              {project.settings.language}
                            </span>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="mt-4 pt-4 border-t border-[#393B3F] flex items-center justify-between text-xs text-[#FFF5F5]/70">
                      <span className="flex items-center space-x-1 font-mono text-[11px]">
                        <Layers className="w-3.5 h-3.5 text-[#E3B5BE]" />
                        <span>
                          {isArchived
                            ? 'Archived'
                            : project.isDemo
                              ? 'Trial Sequence'
                              : 'Studio Master'}
                        </span>
                      </span>
                      <span className="font-bold text-xs flex items-center space-x-1 text-[#E3B5BE] group-hover:text-[#F7D7D1] transition-colors">
                        <span>{isArchived ? 'View Snapshot' : 'Open Studio'}</span>
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
          onClose={() => {
            setIsUploadOpen(false);
            queryClient.invalidateQueries({ queryKey: ['projects'] });
          }}
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

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        defaultMode="login"
      />

      {/* Accessible Non-Blocking Delete Confirmation Dialog */}
      <ConfirmModal
        isOpen={!!projectToDelete}
        title="Delete Project"
        description="Are you sure you want to permanently delete this project? All associated video edits, AI timelines, and exported assets will be removed."
        itemName={projectToDelete?.title}
        confirmLabel="Permanently Delete"
        cancelLabel="Keep Project"
        isDestructive={true}
        isLoading={deleteMutation.isPending}
        onConfirm={() => {
          if (projectToDelete) {
            deleteMutation.mutate(projectToDelete.id);
          }
        }}
        onClose={() => setProjectToDelete(null)}
      />
    </div>
  );
};
