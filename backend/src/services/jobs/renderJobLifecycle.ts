import { RenderJobModel, IRenderJobDocument, JobState, JobType, JobProfile } from '../../models/RenderJob.js';
import { JobEventsPublisher } from '../queue/queueService.js';
import { AppError } from '../../middleware/errorHandler.js';

export const VALID_STATE_TRANSITIONS: Record<JobState, JobState[]> = {
  queued: ['processing', 'active', 'failed', 'canceled'],
  active: ['processing', 'uploading_output', 'completed', 'failed', 'canceled'],
  processing: ['uploading_output', 'completed', 'failed', 'canceled'],
  uploading_output: ['completed', 'failed', 'canceled'],
  completed: [], // Terminal
  failed: [],    // Terminal
  canceled: [],  // Terminal
};

export const TERMINAL_STATES: JobState[] = ['completed', 'failed', 'canceled'];

export interface JobErrorDetails {
  code: string;
  message: string;
  retryable: boolean;
  details?: any;
}

export class RenderJobLifecycle {
  /**
   * Classifies error code and determines retryability according to API Contract §7.2.
   */
  static classifyError(err: any): JobErrorDetails {
    const code = err.code || 'RENDER_FAILED';
    const message = err.message || 'Operation failed';

    // API Contract §7.2:
    // INPUT_CORRUPT: No retry
    // FILTER_ERROR: No automatic retry
    // OOM_OR_TIMEOUT: Retry once
    // S3_TRANSIENT: Retry with backoff
    if (code === 'INPUT_CORRUPT' || code === 'FILTER_ERROR') {
      return { code, message, retryable: false, details: err.details };
    }

    if (code === 'OOM_OR_TIMEOUT' || code === 'S3_TRANSIENT') {
      return { code, message, retryable: true, details: err.details };
    }

    const isNonRetryable =
      message.toLowerCase().includes('corrupt') ||
      message.toLowerCase().includes('validation') ||
      code.includes('INVALID');

    return {
      code,
      message,
      retryable: !isNonRetryable,
      details: err.details,
    };
  }

  /**
   * Checks whether a state transition is valid and monotonic.
   */
  static canTransition(fromState: JobState, toState: JobState): boolean {
    if (fromState === toState) return true;
    const allowed = VALID_STATE_TRANSITIONS[fromState];
    return Array.isArray(allowed) && allowed.includes(toState);
  }

  /**
   * Performs an atomic, monotonic state transition on a RenderJob.
   * Guarantees terminal states cannot be regressed by late or out-of-order worker progress events.
   */
  static async transition(
    jobId: string,
    targetState: JobState,
    updates?: {
      percent?: number;
      etaSec?: number;
      workerId?: string;
      outTimeMs?: number;
      output?: {
        key: string;
        sizeBytes: number;
        durationMs: number;
        checksum?: string;
      };
      error?: any;
    }
  ): Promise<IRenderJobDocument | null> {
    const cleanId = jobId.replace(/^job_/, '');
    const job = await RenderJobModel.findById(cleanId);

    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', `RenderJob ${jobId} not found`);
    }

    // Terminal guard: once completed, failed or canceled, never regress to active/processing
    if (TERMINAL_STATES.includes(job.state)) {
      console.warn(
        `[RenderJobLifecycle] Monotonic guard: ignoring transition from terminal state ${job.state} to ${targetState} for job ${jobId}`
      );
      return job;
    }

    if (!this.canTransition(job.state, targetState)) {
      throw new AppError(
        409,
        'INVALID_STATE_TRANSITION',
        `Cannot transition RenderJob ${jobId} from ${job.state} to ${targetState}`
      );
    }

    job.state = targetState;

    if (updates?.workerId) {
      job.workerId = updates.workerId;
    }

    if (updates?.percent !== undefined) {
      // Progress percent must never decrease
      job.percent = Math.max(job.percent, updates.percent);
    }

    if (updates?.etaSec !== undefined) {
      job.etaSec = updates.etaSec;
    }

    // Timing tracking
    const now = new Date();
    if (targetState === 'processing' || targetState === 'active') {
      if (!job.timings.startedAt) {
        job.timings.startedAt = now;
      }
    } else if (targetState === 'completed') {
      job.timings.finishedAt = now;
      job.percent = 100;
      if (job.timings.startedAt) {
        job.timings.durationMs = now.getTime() - job.timings.startedAt.getTime();
      }
      if (updates?.output) {
        job.output = updates.output;
      }
    } else if (targetState === 'failed') {
      job.timings.finishedAt = now;
      if (job.timings.startedAt) {
        job.timings.durationMs = now.getTime() - job.timings.startedAt.getTime();
      }
      job.error = this.classifyError(updates?.error || {});
    } else if (targetState === 'canceled') {
      job.timings.finishedAt = now;
      if (job.timings.startedAt) {
        job.timings.durationMs = now.getTime() - job.timings.startedAt.getTime();
      }
    }

    await job.save();

    // Relay event via Redis pub/sub channel for SSE subscribers
    await JobEventsPublisher.publishProgress(cleanId, {
      jobId: `job_${cleanId}`,
      state: targetState === 'completed' ? 'done' : targetState,
      percent: job.percent,
      outTimeMs: updates?.outTimeMs,
      outputKey: job.output?.key,
      error: job.error,
    });

    return job;
  }
}

