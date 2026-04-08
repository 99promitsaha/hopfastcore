import { Router } from 'express';
import healthRoutes from './health.routes.js';
import quotesRoutes from './quotes.routes.js';
import swapsRoutes from './swaps.routes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/', quotesRoutes);
router.use('/', swapsRoutes);

export default router;
