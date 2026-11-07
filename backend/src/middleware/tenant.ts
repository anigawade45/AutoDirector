import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { ProjectModel, IProject } from '../models/Project.js';

declare global {
  namespace Express {
    interface Request {
      project?: IProject;
    }
  }
}

/**
 * Ensures that the project specified by :id or :projectId exists and belongs to the authenticated user.
 */
export async function requireProjectOwner(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const projectIdParam = req.params.id || req.params.projectId || req.body?.projectId;

  if (!projectIdParam) {
    return next(new AppError(400, 'BAD_REQUEST', 'Project ID parameter is required'));
  }

  if (!req.user) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'User authentication required'));
  }

  try {
    const project = await ProjectModel.findOne({
      publicId: projectIdParam,
      userId: req.user._id,
      deletedAt: null,
    });

    if (!project) {
      return next(
        new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found in user workspace or unauthorized')
      );
    }

    req.project = project;
    next();
  } catch (error) {
    next(error);
  }
}

