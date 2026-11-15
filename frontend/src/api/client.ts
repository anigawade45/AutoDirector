import {
  CreateUploadRequest,
  CreateUploadResponseData,
  CompleteUploadRequest,
  CompleteUploadResponseData,
  PromptRequest,
  PromptResponseData,
  PatchPlanRequest,
  EnqueuePreviewRequest,
  EnqueueExportRequest,
  EnqueueJobResponseData,
  DownloadUrlResponseData,
  ApiSuccessResponse,
  UserProfile,
  AuthResponseData,
  RegisterRequest,
  LoginRequest,
} from '@ai-video/shared';

function getBaseUrl(): string {
  let raw = (import.meta.env.VITE_API_BASE_URL || '').trim();

  // Automatic production resolution when hosted on Render
  if (typeof window !== 'undefined' && window.location.hostname.includes('onrender.com')) {
    if (!raw || raw === '/api' || !raw.includes('.')) {
      return 'https://ai-video-api-eaui.onrender.com/api';
    }
  }

  if (!raw || raw === '/api' || raw.startsWith('/')) {
    return raw ? raw.replace(/\/+$/, '') : '/api';
  }

  let url = raw;
  if (!url.includes('.')) {
    url = `${url}.onrender.com`;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  if (!url.endsWith('/api')) {
    url = `${url.replace(/\/+$/, '')}/api`;
  }
  return url;
}

const BASE_URL = getBaseUrl();

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const payload = await response.json();

  if (!response.ok || !payload.success) {
    const error = new Error(payload?.error?.message || 'API request failed') as any;
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }

  return (payload as ApiSuccessResponse<T>).data;
}

export const api = {
  // Auth
  register: (data: RegisterRequest) =>
    request<AuthResponseData>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: LoginRequest) =>
    request<AuthResponseData>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMe: () => request<{ user: UserProfile }>('/auth/me'),

  // Uploads
  createUploadSession: (data: CreateUploadRequest) =>
    request<CreateUploadResponseData>('/uploads', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  completeUpload: (uploadId: string, data: CompleteUploadRequest) =>
    request<CompleteUploadResponseData>(`/uploads/${uploadId}/complete`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  abortUpload: (uploadId: string) =>
    request<{ aborted: boolean }>(`/uploads/${uploadId}/abort`, {
      method: 'POST',
    }),

  // Projects
  listProjects: (status?: string) =>
    request<any[]>(`/projects${status ? `?status=${encodeURIComponent(status)}` : ''}`),

  createProject: (data: { title: string; settings?: any }) =>
    request<any>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getProject: (projectId: string) => request<any>(`/projects/${projectId}`),

  updateProject: (projectId: string, data: { title?: string; settings?: any; status?: string }) =>
    request<any>(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  archiveProject: (projectId: string) =>
    request<any>(`/projects/${projectId}/archive`, {
      method: 'POST',
    }),

  unarchiveProject: (projectId: string) =>
    request<any>(`/projects/${projectId}/unarchive`, {
      method: 'POST',
    }),

  deleteProject: (projectId: string) =>
    request<{ deleted: boolean; publicId: string }>(`/projects/${projectId}`, {
      method: 'DELETE',
    }),

  // Prompts & AI Planning
  getChatHistory: (projectId: string) =>
    request<{ projectId: string; messages: any[] }>(`/projects/${projectId}/chat`),

  sendChatMessage: (projectId: string, text: string, role: string = 'user') =>
    request<any>(`/projects/${projectId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ text, role }),
    }),

  submitPrompt: (projectId: string, data: PromptRequest) =>
    request<PromptResponseData>(`/projects/${projectId}/prompt`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Plan versions & patches
  getPlanVersion: (projectId: string, version?: number | string) => {
    const v =
      version !== undefined && version !== null && !isNaN(Number(version)) ? version : 'latest';
    return request<any>(`/projects/${projectId}/plans/${v}`);
  },

  patchPlan: (projectId: string, version: number | string, data: PatchPlanRequest) => {
    const v =
      version !== undefined && version !== null && !isNaN(Number(version)) ? version : 'latest';
    return request<any>(`/projects/${projectId}/plans/${v}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  revertPlan: (projectId: string, version: number | string) =>
    request<any>(`/projects/${projectId}/plans/${version}/revert`, {
      method: 'POST',
    }),

  // Previews & Exports
  enqueuePreview: (projectId: string, data: EnqueuePreviewRequest) =>
    request<EnqueueJobResponseData>(`/projects/${projectId}/preview`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  enqueueExport: (projectId: string, data: EnqueueExportRequest) =>
    request<EnqueueJobResponseData>(`/projects/${projectId}/export`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Captions
  updateCaptions: (projectId: string, cues: any[], language?: string) =>
    request<any>(`/projects/${projectId}/captions`, {
      method: 'PATCH',
      body: JSON.stringify({ cues, language }),
    }),

  // Jobs & SSE
  getJobStatus: (jobId: string) => request<any>(`/jobs/${jobId}`),

  getJobDownloadUrl: (jobId: string) => request<DownloadUrlResponseData>(`/jobs/${jobId}/download`),

  subscribeToJobEvents: (
    jobId: string,
    onProgress: (data: any) => void,
    onError?: (err: any) => void
  ): (() => void) => {
    const cleanId = jobId.replace(/^job_/, '');
    let isFinished = false;
    let eventSource: EventSource | null = null;
    let pollTimer: any = null;

    const handleTerminalOrProgress = (data: any) => {
      if (isFinished) return;
      const state = data?.state;
      const isDone = state === 'done' || state === 'completed';
      const isFailed = state === 'failed';

      if (isDone) {
        isFinished = true;
        onProgress({ ...data, state: 'done', percent: 100 });
        cleanup();
      } else if (isFailed) {
        isFinished = true;
        onProgress({ ...data, state: 'failed' });
        cleanup();
      } else {
        onProgress(data);
      }
    };

    // 1. Live SSE Connection
    try {
      eventSource = new EventSource(`${BASE_URL}/jobs/${cleanId}/events`);

      eventSource.addEventListener('progress', (e) => {
        try {
          handleTerminalOrProgress(JSON.parse(e.data));
        } catch (err) {
          console.error('Error parsing progress SSE event:', err);
        }
      });

      eventSource.addEventListener('state', (e) => {
        try {
          handleTerminalOrProgress(JSON.parse(e.data));
        } catch (err) {
          console.error('Error parsing state SSE event:', err);
        }
      });

      eventSource.addEventListener('done', (e) => {
        try {
          handleTerminalOrProgress(JSON.parse(e.data));
        } catch (err) {
          console.error('Error parsing done SSE event:', err);
        }
      });

      eventSource.onmessage = (e) => {
        try {
          handleTerminalOrProgress(JSON.parse(e.data));
        } catch {}
      };

      eventSource.addEventListener('error', (e) => {
        // SSE error or early socket close - fallback poller will complete the job seamlessly
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
      });
    } catch (e) {
      console.warn('Failed to initialize EventSource, using polling fallback:', e);
    }

    // 2. High-res polling fallback: guarantees job completion even if job finished before SSE attached
    const pollStatus = async () => {
      if (isFinished) return;
      try {
        const job = await api.getJobStatus(cleanId);
        if (job) {
          handleTerminalOrProgress(job);
        }
      } catch (err) {
        // Ignore background polling errors
      }
    };

    // Immediate poll check (covers jobs finished in < 100ms)
    pollStatus();
    pollTimer = setInterval(pollStatus, 1500);

    const cleanup = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    return cleanup;
  },
};
