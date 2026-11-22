import { Router } from 'express';
import { ProjectsController } from '../controllers/projectsController.js';
import { PromptsController } from '../controllers/promptsController.js';
import { PlansController } from '../controllers/plansController.js';
import { RendersController } from '../controllers/rendersController.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireProjectOwner } from '../middleware/tenant.js';
import { aiPlannerRateLimiter, renderRateLimiter } from '../middleware/rateLimiter.js';

export const projectsRouter = Router();

projectsRouter.use(authMiddleware);

// Project management - collection level
projectsRouter.get('/', ProjectsController.listProjects);
projectsRouter.post('/', ProjectsController.createProject);
projectsRouter.post('/demo', ProjectsController.createDemoProject);

// Project management - item level (enforced via requireProjectOwner tenant isolation middleware)
projectsRouter.get('/:id', requireProjectOwner, ProjectsController.getProject);
projectsRouter.patch('/:id', requireProjectOwner, ProjectsController.updateProject);
projectsRouter.post('/:id/archive', requireProjectOwner, ProjectsController.archiveProject);
projectsRouter.post('/:id/unarchive', requireProjectOwner, ProjectsController.unarchiveProject);
projectsRouter.delete('/:id', requireProjectOwner, ProjectsController.deleteProject);
projectsRouter.delete('/:id/purge', requireProjectOwner, ProjectsController.purgeProject);

// AI Prompt & Chat History
projectsRouter.get('/:id/chat', requireProjectOwner, PromptsController.getChatHistory);
projectsRouter.post('/:id/chat', requireProjectOwner, PromptsController.postChatMessage);
projectsRouter.post(
  '/:id/prompt',
  aiPlannerRateLimiter,
  requireProjectOwner,
  PromptsController.submitPrompt
);

// Immutable Plan Versioning & Patches
projectsRouter.get('/:id/plans', requireProjectOwner, PlansController.listPlanVersions);
projectsRouter.get('/:id/plans/:v', requireProjectOwner, PlansController.getPlanVersion);
projectsRouter.patch('/:id/plans/:v', requireProjectOwner, PlansController.patchPlan);
projectsRouter.post('/:id/plans/:v/revert', requireProjectOwner, PlansController.revertPlan);

// Previews & Exports (Rate limited to protect GPU/CPU rendering resources)
projectsRouter.post(
  '/:id/preview',
  renderRateLimiter,
  requireProjectOwner,
  RendersController.enqueuePreview
);
projectsRouter.post(
  '/:id/export',
  renderRateLimiter,
  requireProjectOwner,
  RendersController.enqueueExport
);

// Captions & Subtitles
projectsRouter.patch('/:id/captions', requireProjectOwner, ProjectsController.updateCaptions);
