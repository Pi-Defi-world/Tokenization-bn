import { Request, Response } from 'express';
import Log from '../../models/Log';
import { loggingService } from '../../services/logging.service';

interface LogsQuery {
  level?: 'error' | 'warn' | 'info' | 'success';
  userId?: string;
  route?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  page?: number;
  requestId?: string;
}

/**
 * Get logs with filtering and pagination
 * GET /v1/admin/logs
 */
export const getLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      level,
      userId,
      route,
      startDate,
      endDate,
      limit = 50,
      page = 1,
      requestId,
    } = req.query as LogsQuery;

    // Build query
    const query: any = {};

    if (level) {
      query.level = level;
    }

    if (userId) {
      query['context.userId'] = userId;
    }

    if (route) {
      query['context.route'] = { $regex: route, $options: 'i' };
    }

    if (requestId) {
      query['context.requestId'] = requestId;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(String(page), 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10))); // Max 100 per page
    const skip = (pageNum - 1) * limitNum;

    // Execute query
    const [logs, total] = await Promise.all([
      Log.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Log.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    loggingService.error('Failed to fetch logs', req, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch logs',
      code: 'LOGS_FETCH_ERROR',
      requestId: req.requestId,
    });
  }
};

/**
 * Get log statistics
 * GET /v1/admin/logs/stats
 */
export const getLogStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

    const dateQuery: any = {};
    if (startDate || endDate) {
      dateQuery.createdAt = {};
      if (startDate) {
        dateQuery.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        dateQuery.createdAt.$lte = new Date(endDate);
      }
    }

    const [errorCount, warnCount, infoCount, totalCount] = await Promise.all([
      Log.countDocuments({ ...dateQuery, level: 'error' }),
      Log.countDocuments({ ...dateQuery, level: 'warn' }),
      Log.countDocuments({ ...dateQuery, level: 'info' }),
      Log.countDocuments(dateQuery),
    ]);

    // Get most common errors
    const topErrors = await Log.aggregate([
      { $match: { ...dateQuery, level: 'error' } },
      { $group: { _id: '$message', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    res.json({
      success: true,
      data: {
        counts: {
          error: errorCount,
          warn: warnCount,
          info: infoCount,
          total: totalCount,
        },
        topErrors,
      },
    });
  } catch (error: any) {
    loggingService.error('Failed to fetch log stats', req, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch log statistics',
      code: 'LOGS_STATS_ERROR',
      requestId: req.requestId,
    });
  }
};

/**
 * Get logs by request ID
 * GET /v1/admin/logs/request/:requestId
 */
export const getLogsByRequestId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;

    const logs = await Log.find({ 'context.requestId': requestId })
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      success: true,
      data: logs,
    });
  } catch (error: any) {
    loggingService.error('Failed to fetch logs by request ID', req, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch logs',
      code: 'LOGS_FETCH_ERROR',
      requestId: req.requestId,
    });
  }
};

