import { Router } from 'express';
import { WorkerEventsController } from '../controllers/workerEventsController.js';
import { MaintenanceService } from '../services/maintenance/maintenanceService.js';
import { verifyWorkerSignature, verifyInternalAuth } from '../middleware/workerAuth.js';
import { maintenanceRateLimiter } from '../middleware/rateLimiter.js';
import { AppError } from '../middleware/errorHandler.js';
import { StructuredLogger } from '../services/observability/logger.js';

export const internalRouter = Router();

// Internal worker callbacks authenticated via HMAC-SHA256 signature
internalRouter.post(
  '/v1/worker-events',
  verifyWorkerSignature,
  WorkerEventsController.handleWorkerEvent
);

// Trigger abandoned uploads cleanup on demand (protected via internal secret / worker signature)
internalRouter.post(
  '/v1/maintenance/cleanup-uploads',
  maintenanceRateLimiter,
  verifyInternalAuth,
  async (req, res, next) => {
    try {
      let olderThanHours = 24;
      if (req.body?.olderThanHours !== undefined) {
        const raw = req.body.olderThanHours;
        const parsed =
          typeof raw === 'number'
            ? raw
            : typeof raw === 'string' && /^\d+$/.test(raw.trim())
              ? parseInt(raw.trim(), 10)
              : NaN;

        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 720) {
          throw new AppError(
            400,
            'INVALID_CLEANUP_THRESHOLD',
            'olderThanHours must be an integer between 1 and 720 (up to 30 days)'
          );
        }
        olderThanHours = parsed;
      }

      StructuredLogger.info('[Maintenance] Executing on-demand abandoned upload cleanup', {
        olderThanHours,
        callerIp: req.ip || req.socket.remoteAddress,
        requestId: req.id,
      });

      const result = await MaintenanceService.runAbandonedUploadCleanup(
        olderThanHours * 60 * 60 * 1000
      );

      StructuredLogger.info('[Maintenance] Completed abandoned upload cleanup', {
        olderThanHours,
        abortedCount: result.abortedCount,
        purgedScratchCount: result.purgedScratchCount,
        stalePreviewsCount: result.stalePreviewsCount,
        requestId: req.id,
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
