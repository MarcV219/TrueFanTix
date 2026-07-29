export type DisputeCase = {
  type: "BUYER_DISPUTE";
  openedAt?: string;
  openedByUserId?: string;
  ticketIds?: string[];
  ticketCount?: number;
  reason?: string;
  evidence?: string | null;
  evidenceFiles?: Array<{ data: string; fileName: string }>;
  submissions?: Array<{
    id: string;
    submittedAt: string;
    submittedByUserId: string;
    submittedByRole: "BUYER" | "SELLER";
    comments: string | null;
    evidenceFiles: Array<{ data: string; fileName: string }>;
  }>;
  adminRequests?: Array<{
    id: string;
    requestedAt: string;
    requestedByUserId: string;
    recipient: "BUYER" | "SELLER" | "BOTH";
    message: string;
    deliveries: Array<{ role: "BUYER" | "SELLER"; email: string; status: "SENT" | "FAILED" }>;
  }>;
  cancellation?: {
    cancelledAt: string;
    cancelledByUserId: string;
    satisfactorilyResolved: true;
  };
};

export function parseDisputeCase(value: string | null): DisputeCase | null {
  if (!value) return null;
  try {
    let parsed = JSON.parse(value) as (DisputeCase & { dispute?: unknown }) | null;
    for (let depth = 0; parsed && depth < 10; depth += 1) {
      if (parsed.type === "BUYER_DISPUTE") return parsed;
      parsed =
        typeof parsed.dispute === "object" && parsed.dispute !== null
          ? parsed.dispute as DisputeCase & { dispute?: unknown }
          : null;
    }
    return null;
  } catch {
    return null;
  }
}

export type VisibleAdminRequest = {
  id: string;
  requestedAt: string;
  message: string;
};

export function visibleAdminRequests(
  value: string | null,
  role: "BUYER" | "SELLER"
): VisibleAdminRequest[] {
  const dispute = parseDisputeCase(value);
  if (!dispute?.adminRequests?.length) return [];
  return dispute.adminRequests
    .filter((request) => request.recipient === role || request.recipient === "BOTH")
    .map((request) => ({
      id: request.id,
      requestedAt: request.requestedAt,
      message: request.message,
    }));
}

export function pendingAdminRequests(
  value: string | null,
  role: "BUYER" | "SELLER"
): VisibleAdminRequest[] {
  const dispute = parseDisputeCase(value);
  if (!dispute?.adminRequests?.length) return [];
  const latestReplyAt = (dispute.submissions || [])
    .filter((submission) => submission.submittedByRole === role)
    .reduce((latest, submission) => Math.max(latest, Date.parse(submission.submittedAt) || 0), 0);
  return visibleAdminRequests(value, role).filter(
    (request) => (Date.parse(request.requestedAt) || 0) > latestReplyAt
  );
}
