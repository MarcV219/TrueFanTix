import { prisma } from "./prisma";

export type AuditAction =
  | "USER_LOGIN"
  | "USER_LOGOUT"
  | "USER_REGISTER"
  | "TICKET_CREATE"
  | "TICKET_UPDATE"
  | "TICKET_DELETE"
  | "TICKET_PURCHASE"
  | "ORDER_CREATE"
  | "ORDER_UPDATE"
  | "ORDER_CANCEL"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "TRANSFER_PROOF_SUBMIT"
  | "RECEIPT_CONFIRM"
  | "DISPUTE_OPEN"
  | "DISPUTE_RESOLVE"
  | "PAYOUT_REQUEST"
  | "PAYOUT_COMPLETE"
  | "SELLER_VERIFY"
  | "ADMIN_ACTION"
  | "NOTIFICATION_CREATE"
  | "PREFERENCE_UPDATE";

interface AuditLogEntry {
  action: AuditAction;
  userId?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create an audit log entry
 */
export async function auditLog(entry: AuditLogEntry) {
  try {
    // Store in database
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });

    // Also log to console for real-time monitoring
    console.log(`[AUDIT] ${entry.action}`, {
      userId: entry.userId,
      target: `${entry.targetType}:${entry.targetId}`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Don't fail the operation if audit logging fails
    console.error("[AUDIT] Failed to create audit log:", err);
  }
}

/**
 * Middleware to capture request context for audit logs
 */
export function createAuditContext(req: Request) {
  return {
    ipAddress: req.headers.get("x-forwarded-for") || "unknown",
    userAgent: req.headers.get("user-agent") || "unknown",
  };
}

/**
 * Query audit logs with filters
 */
export async function queryAuditLogs({
  userId,
  action,
  targetType,
  targetId,
  fromDate,
  toDate,
  limit = 100,
  offset = 0,
}: {
  userId?: string;
  action?: AuditAction;
  targetType?: string;
  targetId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const where: any = {};

  if (userId) where.userId = userId;
  if (action) where.action = action;
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate) where.createdAt.lte = toDate;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs: logs.map(log => ({
      ...log,
      metadata: log.metadata ? JSON.parse(log.metadata) : null,
    })),
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}

/**
 * Get recent activity for a user
 */
export async function getUserActivity(userId: string, limit = 50) {
  return queryAuditLogs({
    userId,
    limit,
  });
}

/**
 * Get security events (failed logins, suspicious activity)
 */
export async function getSecurityEvents(fromDate?: Date) {
  return queryAuditLogs({
    action: "USER_LOGIN",
    fromDate,
    limit: 1000,
  });
}
