import { Router } from 'express';
import { JobsController } from '../controllers/jobsController.js';
import { authMiddleware } from '../middleware/auth.js';

export const jobsRouter = Router();

jobsRouter.use(authMiddleware);

jobsRouter.get('/:id', JobsController.getJob);
jobsRouter.get('/:id/events', JobsController.getJobEvents);
jobsRouter.get('/:id/download', JobsController.getJobDownload);

