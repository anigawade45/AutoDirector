import { Router } from 'express';
import { UploadsController } from '../controllers/uploadsController.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireProjectOwner } from '../middleware/tenant.js';

export const uploadsRouter = Router();

uploadsRouter.use(authMiddleware);

uploadsRouter.post('/', requireProjectOwner, UploadsController.createUpload);
uploadsRouter.post('/:id/complete', UploadsController.completeUpload);
uploadsRouter.post('/:id/abort', UploadsController.abortUpload);
