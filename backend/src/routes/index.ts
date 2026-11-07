import { Router } from 'express';
import { uploadsRouter } from './uploads.routes.js';
import { projectsRouter } from './projects.routes.js';
import { jobsRouter } from './jobs.routes.js';
import { internalRouter } from './internal.routes.js';
import { catalogRouter } from './catalog.routes.js';
import { authRouter } from './auth.routes.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/uploads', uploadsRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/jobs', jobsRouter);
apiRouter.use('/internal', internalRouter);
apiRouter.use('/catalog', catalogRouter);
