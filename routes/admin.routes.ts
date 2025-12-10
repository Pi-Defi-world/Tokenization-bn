import { Router } from 'express';
import { isAuthenticated } from '../middlewares/isAuthenticated';
import { isAdmin } from '../middlewares/isAdmin';
import * as logsController from '../controllers/admin/logs.controller';

const adminRoutes = Router();

// All admin routes require authentication and admin role
adminRoutes.use(isAuthenticated);
adminRoutes.use(isAdmin);

// Logs endpoints
adminRoutes.get('/logs', logsController.getLogs);
adminRoutes.get('/logs/stats', logsController.getLogStats);
adminRoutes.get('/logs/request/:requestId', logsController.getLogsByRequestId);

export default adminRoutes;

