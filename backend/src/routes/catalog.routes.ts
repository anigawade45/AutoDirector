import { Router } from 'express';
import { CatalogController } from '../controllers/catalogController.js';
import { authMiddleware } from '../middleware/auth.js';

export const catalogRouter = Router();

catalogRouter.use(authMiddleware);
catalogRouter.get('/', CatalogController.getCatalog);

