export const TRANSFER_PROOF_REVIEW_ACTIONS = ["APPROVE", "REJECT", "REQUEST_INFORMATION"] as const;

export type TransferProofReviewAction = typeof TRANSFER_PROOF_REVIEW_ACTIONS[number];

export function transferProofStatusForAdminAction(action: TransferProofReviewAction) {
  if (action === "APPROVE") return "PENDING";
  if (action === "REJECT") return "MISMATCHED";
  return "MANUAL_REVIEW";
}

export function transferProofAdminActionMessage(action: TransferProofReviewAction) {
  if (action === "APPROVE") return "Transfer proof approved. The buyer has been asked to confirm receipt.";
  if (action === "REJECT") return "Transfer proof rejected. The seller has been asked to upload corrected documentation.";
  return "More information requested from the seller. The review remains in the Admin Queue.";
}
