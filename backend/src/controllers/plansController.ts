import { Request, Response, NextFunction } from 'express';
import { ProjectModel } from '../models/Project.js';
import { EditPlanModel } from '../models/EditPlan.js';
import { TimelineModel } from '../models/Timeline.js';
import { TimelineVersionModel } from '../models/TimelineVersion.js';
import { AssetModel } from '../models/Asset.js';
import { PlanResolver } from '../services/resolver/planResolver.js';
import { EditPlanSchema, EditPlan, validateEditPlan } from '@ai-video/shared';
import { PlanNormalizer } from '../services/planner/planNormalizer.js';
import { AppError } from '../middleware/errorHandler.js';
import fastJsonPatch from 'fast-json-patch';
import crypto from 'crypto';

export class PlansController {
  static async getPlanVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: projectId, v: versionStr } = req.params;
      const version = parseInt(versionStr, 10);

      const project =
        req.project ||
        (await ProjectModel.findOne({
          publicId: projectId,
          userId: req.user!._id,
          deletedAt: null,
        }));
      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      }

      let planDoc = null;
      if (versionStr === 'latest') {
        planDoc = await EditPlanModel.findOne({ projectId: project._id }).sort({ version: -1 });
      } else if (isNaN(version) || version <= 0) {
        throw new AppError(
          400,
          'BAD_REQUEST',
          'Plan version must be a positive integer or "latest"'
        );
      } else {
        planDoc = await EditPlanModel.findOne({ projectId: project._id, version });
      }

      if (!planDoc) {
        throw new AppError(404, 'PLAN_NOT_FOUND', `Edit plan version ${versionStr} not found`);
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

      if (isNaN(baseVersion)) {
        throw new AppError(400, 'BAD_REQUEST', 'Base version must be a valid number');
      }

      if (!Array.isArray(patch)) {
        throw new AppError(
          400,
          'BAD_REQUEST',
          'Patch must be an array of RFC 6902 patch operations'
        );
      }

      const project =
        req.project ||
        (await ProjectModel.findOne({
          publicId: projectId,
          userId: req.user!._id,
          deletedAt: null,
        }));
      if (!project) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      }

      if (project.headVersion !== baseVersion) {
        // Auto-heal / bootstrap if the project has not persisted an initial plan yet (headVersion === 0)
        // and the client started editing from the synthesized baseline plan (baseVersion === 0 or 1)
        if (project.headVersion === 0 && (baseVersion === 0 || baseVersion === 1)) {
          let v1Doc = await EditPlanModel.findOne({ projectId: project._id, version: 1 });
          if (!v1Doc) {
            const baselinePlan: EditPlan = {
              schemaVersion: '1.0',
              projectId: project.publicId,
              baseAssetId: project.baseAssetId?.toString() || 'ast_base',
              version: 1,
              parentVersion: null,
              global: {
                aspect: project.settings?.aspect || '16:9',
                fps: project.settings?.fps || 30,
                resolution: '1080p',
              },
              layers: [
                {
                  id: 'lyr_c1',
                  layer: 'color',
                  enabled: true,
                  timebase: 'global',
                  params: {
                    preset: 'cinematic',
                    contrast: 1.15,
                    saturation: 0.95,
                    vignette: 0.25,
                  },
                },
              ],
              meta: {
                prompt: 'Initial baseline setup',
                model: 'system-bootstrap',
                createdAt: new Date().toISOString(),
              },
            };
            try {
              v1Doc = await EditPlanModel.create({
                projectId: project._id,
                version: 1,
                parentVersion: null,
                prompt: 'Initial baseline setup',
                plan: baselinePlan,
                model: 'system-bootstrap',
              });
            } catch (createErr: any) {
              if (createErr.code === 11000) {
                v1Doc = await EditPlanModel.findOne({ projectId: project._id, version: 1 });
              } else {
                throw createErr;
              }
            }
          }
          project.headVersion = 1;
          if (typeof project.save === 'function') {
            await project.save();
          }
        } else {
          throw new AppError(
            409,
            'VERSION_CONFLICT',
            `Cannot patch stale base version ${baseVersion}. Latest is ${project.headVersion}`
          );
        }
      }

      const currentPlanDoc = await EditPlanModel.findOne({
        projectId: project._id,
        version: project.headVersion > 0 ? project.headVersion : baseVersion,
      });

      if (!currentPlanDoc) {
        throw new AppError(404, 'PLAN_NOT_FOUND', 'Base plan version not found');
      }

      // Clone and apply JSON patch with fallback for unresolvable leaf paths
      const clonedPlan = JSON.parse(JSON.stringify(currentPlanDoc.plan));
      let patchResult: any;
      try {
        patchResult = fastJsonPatch.applyPatch(clonedPlan, patch, true, true);
      } catch (patchErr: any) {
        // Fallback: If op: 'replace' targeted a property that does not exist yet, convert to op: 'add'
        try {
          const fallbackPatch = patch.map((op: any) =>
            op.op === 'replace' ? { ...op, op: 'add' } : op
          );
          patchResult = fastJsonPatch.applyPatch(clonedPlan, fallbackPatch, false, true);
        } catch {
          throw new AppError(
            400,
            'PATCH_APPLICATION_FAILED',
            `JSON patch application failed: ${patchErr.message || patchErr}`
          );
        }
      }
      const patchedObject = patchResult.newDocument || clonedPlan;

      const effectiveBaseVersion = project.headVersion > 0 ? project.headVersion : baseVersion;
      const nextVersion = effectiveBaseVersion + 1;
      const asset = await AssetModel.findById(project.baseAssetId);
      const assetDurationSec = (asset?.media?.durationMs || 60000) / 1000;

      // Normalize patched object to ensure all layer types, defaults, and ranges are valid
      const normalizedPlan = PlanNormalizer.normalize(patchedObject, {
        assetDurationSec,
        prompt: `Manual edit on v${effectiveBaseVersion}`,
      });
      normalizedPlan.version = nextVersion;
      normalizedPlan.parentVersion = effectiveBaseVersion;

      // Validate patched object with Zod schema
      const validatedPlan = EditPlanSchema.parse(normalizedPlan) as EditPlan;

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

      // Persist new EditPlan version (with duplicate-key resilience for crashed/replayed transactions)
      let newPlanDoc: any;
      try {
        newPlanDoc = await EditPlanModel.create({
          projectId: project._id,
          version: nextVersion,
          parentVersion: baseVersion,
          prompt: `Manual edit: patched ${patch.length} properties`,
          plan: validatedPlan,
          patch,
          model: 'manual-editor',
        });
      } catch (err: any) {
        if (err.code === 11000 && typeof EditPlanModel.findOneAndUpdate === 'function') {
          newPlanDoc = await EditPlanModel.findOneAndUpdate(
            { projectId: project._id, version: nextVersion },
            {
              $set: {
                parentVersion: baseVersion,
                prompt: `Manual edit: patched ${patch.length} properties`,
                plan: validatedPlan,
                patch,
                model: 'manual-editor',
              },
            },
            { upsert: true, new: true }
          );
        } else {
          throw err;
        }
      }

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

      try {
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
      } catch (err: any) {
        if (err.code === 11000 && typeof TimelineVersionModel.findOneAndUpdate === 'function') {
          await TimelineVersionModel.findOneAndUpdate(
            { projectId: project._id, version: nextVersion },
            {
              $set: {
                userId: req.user!._id,
                parentVersion: baseVersion,
                source: 'manual',
                label: 'Manual adjustment',
                planId: newPlanDoc._id,
                snapshot: resolvedTimeline,
                snapshotHash,
              },
            },
            { upsert: true, new: true }
          );
        } else {
          throw err;
        }
      }

      project.headVersion = nextVersion;
      project.versions = project.versions.filter((v) => v.version !== nextVersion);
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

      const project =
        req.project ||
        (await ProjectModel.findOne({
          publicId: projectId,
          userId: req.user!._id,
          deletedAt: null,
        }));
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

      const asset = await AssetModel.findById(project.baseAssetId);
      const assetDurationSec = (asset?.media?.durationMs || 60000) / 1000;

      const nextVersion = project.headVersion + 1;
      const normalizedPlan = PlanNormalizer.normalize(targetPlanDoc.plan, {
        assetDurationSec,
        prompt: `Reverted to version ${targetVersion}`,
      });
      normalizedPlan.version = nextVersion;
      normalizedPlan.parentVersion = project.headVersion;

      const validatedPlan = EditPlanSchema.parse(normalizedPlan) as EditPlan;

      // Persist new EditPlan version (with duplicate-key resilience)
      let newPlanDoc: any;
      try {
        newPlanDoc = await EditPlanModel.create({
          projectId: project._id,
          version: nextVersion,
          parentVersion: project.headVersion,
          prompt: `Reverted to version ${targetVersion}`,
          plan: validatedPlan,
          patch: [],
          model: 'history-revert',
        });
      } catch (err: any) {
        if (err.code === 11000 && typeof EditPlanModel.findOneAndUpdate === 'function') {
          newPlanDoc = await EditPlanModel.findOneAndUpdate(
            { projectId: project._id, version: nextVersion },
            {
              $set: {
                parentVersion: project.headVersion,
                prompt: `Reverted to version ${targetVersion}`,
                plan: validatedPlan,
                patch: [],
                model: 'history-revert',
              },
            },
            { upsert: true, new: true }
          );
        } else {
          throw err;
        }
      }

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

      try {
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
      } catch (err: any) {
        if (err.code === 11000 && typeof TimelineVersionModel.findOneAndUpdate === 'function') {
          await TimelineVersionModel.findOneAndUpdate(
            { projectId: project._id, version: nextVersion },
            {
              $set: {
                userId: req.user!._id,
                parentVersion: project.headVersion,
                source: 'restore',
                label: `Revert to v${targetVersion}`,
                planId: newPlanDoc._id,
                snapshot: resolvedTimeline,
                snapshotHash,
              },
            },
            { upsert: true, new: true }
          );
        } else {
          throw err;
        }
      }

      const previousHead = project.headVersion;
      project.headVersion = nextVersion;
      project.versions = project.versions.filter((v) => v.version !== nextVersion);
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
