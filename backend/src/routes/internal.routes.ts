import { Router } from 'express';
import { WorkerEventsController } from '../controllers/workerEventsController.js';
import { MaintenanceService } from '../services/maintenance/maintenanceService.js';
import { verifyWorkerSignature } from '../middleware/workerAuth.js';

export const internalRouter = Router();

// Internal worker callbacks authenticated via HMAC-SHA256 signature
internalRouter.post('/v1/worker-events', verifyWorkerSignature, WorkerEventsController.handleWorkerEvent);

// Trigger abandoned uploads cleanup on demand
internalRouter.post('/v1/maintenance/cleanup-uploads', async (req, res, next) => {
  try {
    const olderThanHours = req.body?.olderThanHours ? parseInt(req.body.olderThanHours, 10) : 24;
    const result = await MaintenanceService.runAbandonedUploadCleanup(olderThanHours * 60 * 60 * 1000);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

