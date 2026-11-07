import { Request, Response, NextFunction } from 'express';
import { ProjectModel } from '../models/Project.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { TimelineModel } from '../models/Timeline.js';
import { TimelineVersionModel } from '../models/TimelineVersion.js';
import { AssetModel } from '../models/Asset.js';
import { PlanResolver } from '../services/resolver/planResolver.js';
import { EditPlanSchema, EditPlan, validateEditPlan } from '@ai-video/shared';
import { AppError } from '../middleware/errorHandler.js';
import fastJsonPatch from 'fast-json-patch';
import crypto from 'crypto';

export class PlansController {
  static async getPlanVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: projectId, v: versionStr } = req.params;
      const version = parseInt(versionStr, 10);

      const project = await ProjectModel.findOne({ publicId: projectId, userId: req.user!._id });
      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      }

      const planDoc = await EditPlanModel.findOne({ projectId: project._id, version });
      if (!planDoc) {
        throw new AppError(404, 'PLAN_NOT_FOUND', `Edit plan version ${version} not found`);
      }

      res.status(200).json({
        success: true,
        data: planDoc.plan,
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async patchPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: projectId, v: versionStr } = req.params;
      const baseVersion = parseInt(versionStr, 10);
      const { patch } = req.body;

      if (!Array.isArray(patch)) {
        throw new AppError(
          400,
          'BAD_REQUEST',
          'Patch must be an array of RFC 6902 patch operations'
        );
      }

      const project = await ProjectModel.findOne({ publicId: projectId, userId: req.user!._id });
      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      }

      if (project.headVersion !== baseVersion) {
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          `Cannot patch stale base version ${baseVersion}. Latest is ${project.headVersion}`
        );
      }

      const currentPlanDoc = await EditPlanModel.findOne({
        projectId: project._id,
        version: baseVersion,
      });

      if (!currentPlanDoc) {
        throw new AppError(404, 'PLAN_NOT_FOUND', 'Base plan version not found');
      }

      // Clone and apply JSON patch
      const clonedPlan = JSON.parse(JSON.stringify(currentPlanDoc.plan));
      const patchResult = fastJsonPatch.applyPatch(clonedPlan, patch, true, true);
      const patchedObject = patchResult.newDocument || clonedPlan;

      const nextVersion = baseVersion + 1;
      patchedObject.version = nextVersion;
      patchedObject.parentVersion = baseVersion;

      // Validate patched object with Zod schema
      const validatedPlan = EditPlanSchema.parse(patchedObject) as EditPlan;

      // Update Timeline & validate asset timeline invariants
      const asset = await AssetModel.findById(project.baseAssetId);
      const assetDurationSec = (asset?.media?.durationMs || 60000) / 1000;

      const planValidation = validateEditPlan(validatedPlan, {
        assetDurationSec,
        fps: validatedPlan.global?.fps || 30,
      });

      if (!planValidation.valid) {
        throw new AppError(
          400,
          'INVALID_PLAN',
          `Plan validation failed: ${planValidation.errors.join('; ')}`
        );
      }

      // Persist new EditPlan version
      const newPlanDoc = await EditPlanModel.create({
        projectId: project._id,
        version: nextVersion,
        parentVersion: baseVersion,
        prompt: `Manual edit: patched ${patch.length} properties`,
        plan: validatedPlan,
        patch,
        model: 'manual-editor',
      });

      const resolvedTimeline = PlanResolver.resolve({
        plan: validatedPlan,
        assetDurationMs: asset?.media?.durationMs || 60000,
        sourcePlanObjectId: newPlanDoc._id,
      });

      const snapshotHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(resolvedTimeline))
        .digest('hex');

      await TimelineModel.updateOne(
        { projectId: project._id },
        {
          $set: {
            version: nextVersion,
            tracks: resolvedTimeline.tracks,
            globalEffects: resolvedTimeline.globalEffects,
            durationMs: resolvedTimeline.durationMs,
            sourcePlanId: newPlanDoc._id,
          },
          $inc: { rev: 1 },
        }
      );

      await TimelineVersionModel.create({
        projectId: project._id,
        userId: req.user!._id,
        version: nextVersion,
        parentVersion: baseVersion,
        source: 'manual',
        label: 'Manual adjustment',
        planId: newPlanDoc._id,
        snapshot: resolvedTimeline,
        snapshotHash,
      });

      project.headVersion = nextVersion;
      project.versions.push({
        version: nextVersion,
        label: 'Manual adjustment',
        source: 'manual',
        planId: newPlanDoc._id as any,
        createdAt: new Date(),
      });
      await project.save();

      res.status(200).json({
        success: true,
        data: {
          version: nextVersion,
          parentVersion: baseVersion,
          plan: validatedPlan,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }

  static async revertPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: projectId, v: targetVersionStr } = req.params;
      const targetVersion = parseInt(targetVersionStr, 10);

      const project = await ProjectModel.findOne({ publicId: projectId, userId: req.user!._id });
      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      }

      const targetPlanDoc = await EditPlanModel.findOne({
        projectId: project._id,
        version: targetVersion,
      });

      if (!targetPlanDoc) {
        throw new AppError(
          404,
          'PLAN_NOT_FOUND',
          `Target edit plan version ${targetVersion} not found`
        );
      }

      const nextVersion = project.headVersion + 1;
      const revertedPlan = JSON.parse(JSON.stringify(targetPlanDoc.plan));
      revertedPlan.version = nextVersion;
      revertedPlan.parentVersion = project.headVersion;

      const validatedPlan = EditPlanSchema.parse(revertedPlan) as EditPlan;

      const newPlanDoc = await EditPlanModel.create({
        projectId: project._id,
        version: nextVersion,
        parentVersion: project.headVersion,
        prompt: `Reverted to version ${targetVersion}`,
        plan: validatedPlan,
        patch: [],
        model: 'history-revert',
      });

      const asset = await AssetModel.findById(project.baseAssetId);
      const resolvedTimeline = PlanResolver.resolve({
        plan: validatedPlan,
        assetDurationMs: asset?.media?.durationMs || 60000,
        sourcePlanObjectId: newPlanDoc._id,
      });

      const snapshotHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(resolvedTimeline))
        .digest('hex');

      await TimelineModel.updateOne(
        { projectId: project._id },
        {
          $set: {
            version: nextVersion,
            tracks: resolvedTimeline.tracks,
            globalEffects: resolvedTimeline.globalEffects,
            durationMs: resolvedTimeline.durationMs,
            sourcePlanId: newPlanDoc._id,
          },
          $inc: { rev: 1 },
        }
      );

      await TimelineVersionModel.create({
        projectId: project._id,
        userId: req.user!._id,
        version: nextVersion,
        parentVersion: project.headVersion,
        source: 'restore',
        label: `Revert to v${targetVersion}`,
        planId: newPlanDoc._id,
        snapshot: resolvedTimeline,
        snapshotHash,
      });

      const previousHead = project.headVersion;
      project.headVersion = nextVersion;
      project.versions.push({
        version: nextVersion,
        label: `Revert to v${targetVersion}`,
        source: 'restore',
        planId: newPlanDoc._id as any,
        createdAt: new Date(),
      });
      await project.save();

      res.status(200).json({
        success: true,
        data: {
          version: nextVersion,
          parentVersion: previousHead,
          restoredFromVersion: targetVersion,
          plan: validatedPlan,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}
