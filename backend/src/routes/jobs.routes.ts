import { Router } from 'express';
import { JobsController } from '../controllers/jobsController.js';
import { authMiddleware } from '../middleware/auth.js';
import { jobsRateLimiter } from '../middleware/rateLimiter.js';

export const jobsRouter = Router();

jobsRouter.use(authMiddleware);
jobsRouter.use(jobsRateLimiter);

jobsRouter.get('/metrics/latency', JobsController.getLatencyMetrics);
jobsRouter.get('/:id', JobsController.getJob);
jobsRouter.get('/:id/events', JobsController.getJobEvents);
jobsRouter.post('/:id/events-ticket', JobsController.getJobEventsTicket);
jobsRouter.get('/:id/download', JobsController.getJobDownload);
