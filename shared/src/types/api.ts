import { EditPlan, JsonPatchOperation } from './editPlan.js';
import { RenderProfile, JobState } from './jobs.js';

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiErrorDetail {
  field?: string;
  issue: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
  requestId: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Upload endpoints
export interface CreateUploadRequest {
  projectId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256?: string;
}

export interface PresignedPartUrl {
  partNumber: number;
  url: string;
  expiresAt: string;
}

export interface CreateUploadResponseData {
  uploadId: string;
  assetId: string;
  partSizeBytes: number;
  parts: PresignedPartUrl[];
  expiresAt: string;
}

export interface CompleteUploadPart {
  partNumber: number;
  etag: string;
}

export interface CompleteUploadRequest {
  parts: CompleteUploadPart[];
}

export interface CompleteUploadResponseData {
  assetId: string;
  analysisJobId: string;
  state: JobState;
}

// Prompt endpoint
export interface PromptRequest {
  prompt: string;
  baseVersion?: number;
  requestPreview?: boolean;
}

export interface PromptResponseData {
  planId: string;
  version: number;
  parentVersion?: number | null;
  state: 'planned' | 'planning';
  plan: EditPlan;
  previewJobId?: string;
}

// Patch endpoint
export interface PatchPlanRequest {
  baseVersion: number;
  patch: JsonPatchOperation[];
}

// Preview / Export
export interface EnqueuePreviewRequest {
  planVersion: number;
}

export interface EnqueueExportRequest {
  planVersion: number;
  profile: RenderProfile;
}

export interface EnqueueJobResponseData {
  jobId: string;
  type: string;
  state: JobState;
  eventsUrl: string;
}

export interface DownloadUrlResponseData {
  url: string;
  expiresInSeconds: number;
}

// Project management endpoints
export interface UpdateProjectRequest {
  title?: string;
  status?: 'draft' | 'uploading' | 'analyzing' | 'ready' | 'rendering' | 'error' | 'archived';
  settings?: {
    aspect?: '16:9' | '9:16' | '1:1' | '4:5';
    fps?: 24 | 25 | 30 | 60;
    width?: number;
    height?: number;
    language?: string;
  };
}

