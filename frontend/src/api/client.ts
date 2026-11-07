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
} from '@ai-video/shared';

const BASE_URL = '/api';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload?.error?.message || 'API request failed');
  }

  return (payload as ApiSuccessResponse<T>).data;
}

export const api = {
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
  submitPrompt: (projectId: string, data: PromptRequest) =>
    request<PromptResponseData>(`/projects/${projectId}/prompt`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Plan versions & patches
  getPlanVersion: (projectId: string, version: number) =>
    request<any>(`/projects/${projectId}/plans/${version}`),

  patchPlan: (projectId: string, version: number, data: PatchPlanRequest) =>
    request<any>(`/projects/${projectId}/plans/${version}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
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

  // Jobs & SSE
  getJobStatus: (jobId: string) => request<any>(`/jobs/${jobId}`),

  getJobDownloadUrl: (jobId: string) =>
    request<DownloadUrlResponseData>(`/jobs/${jobId}/download`),

  subscribeToJobEvents: (
    jobId: string,
    onProgress: (data: any) => void,
    onError?: (err: any) => void
  ): (() => void) => {
    const cleanId = jobId.replace(/^job_/, '');
    const eventSource = new EventSource(`${BASE_URL}/jobs/${cleanId}/events`);

    eventSource.addEventListener('progress', (e) => {
      try {
        onProgress(JSON.parse(e.data));
      } catch (err) {
        console.error('Error parsing progress SSE event:', err);
      }
    });

    eventSource.addEventListener('state', (e) => {
      try {
        onProgress(JSON.parse(e.data));
      } catch (err) {
        console.error('Error parsing state SSE event:', err);
      }
    });

    eventSource.addEventListener('done', (e) => {
      try {
        onProgress(JSON.parse(e.data));
        eventSource.close();
      } catch (err) {
        console.error('Error parsing done SSE event:', err);
      }
    });

    eventSource.addEventListener('error', (e) => {
      if (onError) onError(e);
      eventSource.close();
    });

    return () => eventSource.close();
  },
};

