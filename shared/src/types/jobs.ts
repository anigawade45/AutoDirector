export type JobType = 'analysis' | 'preview' | 'export';
export type RenderProfile = 'preview_480p' | 'final_1080p' | 'final_4k';
export type JobState =
  | 'queued'
  | 'active'
  | 'processing'
  | 'uploading_output'
  | 'completed'
  | 'done'
  | 'failed'
  | 'canceled';

export interface RenderJobOutput {
  key: string;
  sizeBytes: number;
  durationMs: number;
  checksum?: string;
}

export interface JobError {
  code:
    | 'INPUT_CORRUPT'
    | 'FILTER_ERROR'
    | 'OOM_OR_TIMEOUT'
    | 'S3_TRANSIENT'
    | 'PROVIDER_RATE_LIMIT'
    | 'PROVIDER_5XX'
    | 'PROVIDER_AUTH_ERROR'
    | 'PLAN_VALIDATION_ERROR'
    | 'INTERNAL_ERROR';
  message: string;
  retryable: boolean;
}

export interface JobTimings {
  queuedAt: Date | string;
  startedAt?: Date | string;
  finishedAt?: Date | string;
  cpuSec?: number;
}

export interface RenderJob {
  id: string; // "job_xxxx"
  projectId: string;
  userId: string;
  timelineVersion: number;
  snapshotHash?: string;
  type: JobType;
  profile: RenderProfile;
  state: JobState;
  percent: number;
  etaSec?: number;
  queueJobId?: string;
  output?: RenderJobOutput;
  error?: JobError;
  timings: JobTimings;
  expiresAt?: Date | string;
}

// Internal Worker Webhook Event Contract
export type WorkerEventType = 'render.progress' | 'render.completed' | 'render.failed' | 'analysis.completed';

export interface BaseWorkerEvent {
  eventId: string;
  eventType: WorkerEventType;
  jobId: string;
  projectId: string;
  occurredAt?: string;
}

export interface RenderProgressEvent extends BaseWorkerEvent {
  eventType: 'render.progress';
  planVersion: number;
  progress: {
    percent: number;
    outTimeMs: number;
  };
}

export interface RenderCompletedEvent extends BaseWorkerEvent {
  eventType: 'render.completed';
  planVersion: number;
  profile: RenderProfile;
  result: {
    outputKey: string;
    durationMs: number;
    width: number;
    height: number;
    sizeBytes: number;
  };
}

export interface RenderFailedEvent extends BaseWorkerEvent {
  eventType: 'render.failed';
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface AnalysisCompletedEvent extends BaseWorkerEvent {
  eventType: 'analysis.completed';
  assetId: string;
  analysisResultId: string;
}

export type WorkerEventPayload =
  | RenderProgressEvent
  | RenderCompletedEvent
  | RenderFailedEvent
  | AnalysisCompletedEvent;

// SSE Progress Event
export interface SSEProgressEvent {
  jobId: string;
  state: JobState;
  percent?: number;
  code?: string;
  downloadUrl?: string | null;
}

