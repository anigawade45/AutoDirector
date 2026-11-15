import { Router } from 'express';
import { ProjectsController } from '../controllers/projectsController.js';
import { PromptsController } from '../controllers/promptsController.js';
import { PlansController } from '../controllers/plansController.js';
import { RendersController } from '../controllers/rendersController.js';
import { authMiddleware } from '../middleware/auth.js';

export const projectsRouter = Router();

projectsRouter.use(authMiddleware);

// Project management
projectsRouter.get('/', ProjectsController.listProjects);
projectsRouter.post('/', ProjectsController.createProject);
projectsRouter.get('/:id', ProjectsController.getProject);
projectsRouter.patch('/:id', ProjectsController.updateProject);
projectsRouter.post('/:id/archive', ProjectsController.archiveProject);
projectsRouter.post('/:id/unarchive', ProjectsController.unarchiveProject);
projectsRouter.delete('/:id', ProjectsController.deleteProject);
projectsRouter.delete('/:id/purge', ProjectsController.purgeProject);

// AI Prompt & Chat History
projectsRouter.get('/:id/chat', PromptsController.getChatHistory);
projectsRouter.post('/:id/chat', PromptsController.postChatMessage);
projectsRouter.post('/:id/prompt', PromptsController.submitPrompt);

// Immutable Plan Versioning & Patches
projectsRouter.get('/:id/plans/:v', PlansController.getPlanVersion);
projectsRouter.patch('/:id/plans/:v', PlansController.patchPlan);
projectsRouter.post('/:id/plans/:v/revert', PlansController.revertPlan);

// Previews & Exports
projectsRouter.post('/:id/preview', RendersController.enqueuePreview);
projectsRouter.post('/:id/export', RendersController.enqueueExport);

// Captions & Subtitles
projectsRouter.patch('/:id/captions', ProjectsController.updateCaptions);
