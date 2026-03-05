import { prisma } from "./prisma";

export type AuditAction =
  // User account actions
  | "USER_LOGIN"
  | "USER_LOGOUT"
  | "USER_REGISTER"
  | "USER_DELETE"
  | "PROFILE_UPDATE"
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET_REQUEST"
  | "PASSWORD_RESET_COMPLETE"
  | "EMAIL_VERIFY_SEND"
  | "EMAIL_VERIFY_SUCCESS"
  | "PHONE_VERIFY_SEND"
  | "PHONE_VERIFY_SUCCESS"
  
  // Account/Seller actions
  | "SELLER_ONBOARDING_START"
  | "SELLER_ONBOARDING_COMPLETE"
  | "SELLER_PROFILE_UPDATE"
  | "SELLER_VERIFY"
  | "SELLER_SUSPEND"
  | "ACCESS_TOKENS_VIEW"
  | "CREDITS_EARNED"
  | "CREDITS_SPENT"
  
  // Ticket actions
  | "TICKET_CREATE"
  | "TICKET_UPDATE"
  | "TICKET_DELETE"
  | "TICKET_WITHDRAW"
  | "TICKET_VERIFY_SUBMIT"
  | "TICKET_VERIFY_SUCCESS"
  | "TICKET_VERIFY_FAIL"
  | "TICKET_ESCROW_DEPOSIT"
  | "TICKET_ESCROW_RELEASE"
  
  // Order/Payment actions
  | "ORDER_CHECKOUT_ATTEMPT"
  | "ORDER_CHECKOUT_SUCCESS"
  | "ORDER_CHECKOUT_BLOCKED"
  | "ORDER_CREATE"
  | "ORDER_UPDATE"
  | "ORDER_CANCEL"
  | "ORDER_REFUND"
  | "PAYMENT_INTENT_CREATE"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "TRANSFER_PROOF_SUBMIT"
  | "TRANSFER_PROOF_VERIFY"
  | "RECEIPT_CONFIRM"
  | "PAYOUT_REQUEST"
  | "PAYOUT_COMPLETE"
  | "PAYOUT_FAILED"
  
  // Dispute/Resolution actions
  | "DISPUTE_OPEN"
  | "DISPUTE_EVIDENCE_SUBMIT"
  | "DISPUTE_RESOLVE"
  | "DISPUTE_APPEAL"
  
  // Community/Forum actions
  | "FORUM_THREAD_CREATE"
  | "FORUM_THREAD_UPDATE"
  | "FORUM_THREAD_DELETE"
  | "FORUM_POST_CREATE"
  | "FORUM_POST_UPDATE"
  | "FORUM_POST_DELETE"
  | "FORUM_THREAD_LOCK"
  | "FORUM_THREAD_UNLOCK"
  
  // Review/Rating actions
  | "REVIEW_CREATE"
  | "REVIEW_UPDATE"
  | "REVIEW_DELETE"
  | "RATING_SUBMIT"
  
  // Waitlist/Alert actions
  | "WAITLIST_JOIN"
  | "WAITLIST_LEAVE"
  | "PRICE_ALERT_CREATE"
  | "PRICE_ALERT_TRIGGER"
  | "PRICE_ALERT_DELETE"
  
  // Notification/Preference actions
  | "NOTIFICATION_CREATE"
  | "NOTIFICATION_SEND"
  | "PREFERENCE_UPDATE"
  | "EARLY_ACCESS_SIGNUP"
  
  // Admin actions
  | "ADMIN_USER_ACTION"
  | "ADMIN_ORDER_ACTION"
  | "ADMIN_TICKET_VERIFY"
  | "ADMIN_FORUM_MODERATE"
  | "ADMIN_EXPORT_DATA"
  | "ADMIN_SETTINGS_UPDATE"
  
  // Security/Risk actions
  | "RATE_LIMIT_TRIGGERED"
  | "SUSPICIOUS_ACTIVITY"
  | "ACCOUNT_BANNED"
  | "ACCOUNT_UNBANNED";

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
