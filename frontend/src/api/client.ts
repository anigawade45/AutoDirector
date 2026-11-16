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
import { AuthStorage } from '../utils/authStorage';

/**
 * Resolves the API base URL based strictly on standard environment configuration.
 *
 * Rules:
 * 1. If VITE_API_BASE_URL is provided:
 *    - If relative (starts with '/'): normalizes trailing slashes (e.g. '/api').
 *    - If absolute (http:// or https://): normalizes and ensures '/api' path suffix.
 * 2. If VITE_API_BASE_URL is missing or empty:
 *    - Defaults cleanly to relative path '/api'.
 * 3. Zero hardcoded hosts: No deployment-specific URLs or platform domain heuristics
 *    are embedded in source code, eliminating silent misconfigurations and cross-environment coupling.
 */
export function resolveApiBaseUrl(rawEnv?: string): string {
  const raw = (rawEnv !== undefined ? rawEnv : import.meta.env.VITE_API_BASE_URL || '').trim();

  // 1. Missing or empty: default to standard relative endpoint '/api'
  if (!raw) {
    return '/api';
  }

  // 2. Relative path (e.g. '/api' or '/v1')
  if (raw.startsWith('/')) {
    return raw.replace(/\/+$/, '') || '/api';
  }

  // 3. Absolute URL
  let url = raw;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  // Strip trailing slashes
  url = url.replace(/\/+$/, '');

  // Ensure /api path suffix if no subpath was provided
  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === '/') {
      return `${url}/api`;
    }
  } catch {
    if (!url.endsWith('/api')) {
      return `${url}/api`;
    }
  }

  return url;
}

export const BASE_URL = resolveApiBaseUrl();

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = AuthStorage.getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // Guard against non-JSON or truncated responses (e.g. 502/504 HTML proxy errors, 204 No Content)
  const contentType = response.headers.get('content-type') || '';
  let payload: any = null;
  let rawText = '';

  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    try {
      rawText = await response.text();
    } catch {
      rawText = '';
    }
  }

  if (!response.ok || !payload || payload.success === false) {
    if (response.status === 401) {
      AuthStorage.clear();
    }
    const message =
      payload?.error?.message ||
      (rawText && rawText.length < 300 ? rawText.trim() : null) ||
      `HTTP Error ${response.status} (${response.statusText || 'Unknown'})`;

    const error = new Error(message) as any;
    error.status = response.status;
    error.code = payload?.error?.code || `HTTP_${response.status}`;
    if (payload?.error?.details) {
      error.details = payload.error.details;
    }
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

  getJobEventsTicket: (jobId: string) =>
    request<{ ticket: string; expiresInSeconds: number }>(`/jobs/${jobId}/events-ticket`, {
      method: 'POST',
    }),

  subscribeToJobEvents: (
    jobId: string,
    onProgress: (data: any) => void,
    onError?: (err: any) => void
  ): (() => void) => {
    const cleanId = jobId.replace(/^job_/, '');
    let isFinished = false;
    let pollTimer: any = null;
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;

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
        if (onError) {
          const errMsg = data?.error?.message || data?.errorMessage || 'Job execution failed';
          const err = new Error(errMsg) as any;
          err.code = data?.error?.code || 'JOB_FAILED';
          err.details = data?.error?.details;
          onError(err);
        }
        cleanup();
      } else {
        onProgress(data);
      }
    };

    const cleanup = () => {
      if (abortController) {
        abortController.abort();
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    // 1. Primary Secure Transport: Fetch streaming with Authorization: Bearer header
    // Eliminates sending auth tokens in URL query strings to protect against exposure in proxy/access logs,
    // browser history, and HTTP Referer headers.
    const startFetchStream = async () => {
      if (typeof fetch === 'undefined') return false;

      try {
        const token = AuthStorage.getToken();
        const response = await fetch(`${BASE_URL}/jobs/${cleanId}/events`, {
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: abortController?.signal,
        });

        if (!response.ok || !response.body) {
          if (!response.ok && !isFinished && onError) {
            onError(new Error(`Failed to subscribe to job events (HTTP ${response.status})`));
          }
          return false;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!isFinished) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split('\n\n');
          buffer = messages.pop() || '';

          for (const msg of messages) {
            const trimmed = msg.trim();
            if (!trimmed) continue;

            const lines = trimmed.split('\n');
            let dataStr = '';

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (line.startsWith('data:')) {
                dataStr = line.slice(5).trim();
              }
            }

            if (dataStr) {
              try {
                const parsed = JSON.parse(dataStr);
                handleTerminalOrProgress(parsed);
              } catch {
                // Ignore parse errors on heartbeat comments or invalid chunks
              }
            }
          }
        }
        return true;
      } catch (err: any) {
        if (err?.name !== 'AbortError' && !isFinished && onError) {
          onError(err);
        }
        return false;
      }
    };

    // Kick off secure fetch stream
    startFetchStream().catch(() => {});

    // 2. High-res polling fallback: guarantees job completion even if job finished before stream attached
    // or if the stream disconnects unexpectedly
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

    return cleanup;
  },
};
