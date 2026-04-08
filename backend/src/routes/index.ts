import { Router } from 'express';
import healthRoutes from './health.routes.js';
import quotesRoutes from './quotes.routes.js';
import swapsRoutes from './swaps.routes.js';
import transactionsRoutes from './transactions.routes.js';
import walletsRoutes from './wallets.routes.js';
import statusRoutes from './status.routes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/', quotesRoutes);
router.use('/', swapsRoutes);
router.use('/', transactionsRoutes);
router.use('/', walletsRoutes);
router.use('/', statusRoutes);

export default router;
