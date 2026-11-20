import { Router } from 'express';
import { UploadsController } from '../controllers/uploadsController.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireProjectOwner } from '../middleware/tenant.js';
import { uploadRateLimiter } from '../middleware/rateLimiter.js';

export const uploadsRouter = Router();

uploadsRouter.use(authMiddleware);
uploadsRouter.use(uploadRateLimiter);

uploadsRouter.post('/', requireProjectOwner, UploadsController.createUpload);
uploadsRouter.get('/active/project/:projectId', UploadsController.getActiveProjectUpload);
uploadsRouter.get('/:id', UploadsController.getUploadStatus);
uploadsRouter.post('/:id/complete', UploadsController.completeUpload);
uploadsRouter.post('/:id/abort', UploadsController.abortUpload);
