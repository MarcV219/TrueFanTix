export const TRANSFER_PROOF_REVIEW_ACTIONS = ["APPROVE", "REJECT", "REQUEST_INFORMATION"] as const;

export type TransferProofReviewAction = typeof TRANSFER_PROOF_REVIEW_ACTIONS[number];

export function transferProofStatusForAdminAction(action: TransferProofReviewAction) {
  if (action === "APPROVE") return "PENDING";
  if (action === "REJECT") return "MISMATCHED";
  return "MANUAL_REVIEW";
}

export function transferProofAdminActionMessage(action: TransferProofReviewAction) {
  if (action === "APPROVE") return "Transfer proof approved. Buyer and seller delivery was queued.";
  if (action === "REJECT") return "Transfer proof rejected. Seller delivery was queued.";
  return "More information requested. Seller delivery was queued and the review remains in the Admin Queue.";
}
