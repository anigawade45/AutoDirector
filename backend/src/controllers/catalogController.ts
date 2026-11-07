import { Request, Response, NextFunction } from 'express';
import { CatalogModel } from '../models/Catalog.js';

export class CatalogController {
  static async getCatalog(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await CatalogModel.find({ active: true }).sort({ kind: 1, name: 1 });

      const music = items
        .filter((c) => c.kind === 'music')
        .map((c) => ({
          id: c.key,
          name: c.name,
          tags: c.tags,
          s3Key: c.s3Key,
          bpm: (c.meta as any)?.bpm || 120,
          mood: (c.meta as any)?.mood || 'general',
          durationMs: (c.meta as any)?.durationMs || 120000,
          license: c.license,
        }));

      const luts = items
        .filter((c) => c.kind === 'lut')
        .map((c) => ({
          id: c.key,
          name: c.name,
          tags: c.tags,
          s3Key: c.s3Key,
          meta: c.meta,
          license: c.license,
        }));

      const templates = items
        .filter((c) => c.kind === 'template')
        .map((c) => ({
          id: c.key,
          name: c.name,
          tags: c.tags,
          s3Key: c.s3Key,
          meta: c.meta,
          license: c.license,
        }));

      const fonts = ['Montserrat', 'Inter', 'Roboto', 'Playfair'];

      res.status(200).json({
        success: true,
        data: {
          music,
          luts,
          templates,
          fonts,
        },
        requestId: req.id,
      });
    } catch (err) {
      next(err);
    }
  }
}

