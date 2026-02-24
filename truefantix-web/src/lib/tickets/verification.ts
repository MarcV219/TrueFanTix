import { PrismaClient } from "@prisma/client";

type TicketForVerification = {
  id: string;
  title: string;
  priceCents: number;
  faceValueCents: number | null;
  image: string;
  venue: string;
  date: string;
  status: string;
  barcodeHash: string | null;
  verificationEvidence: string | null;
};

type VerificationDecision = {
  verificationStatus: string;
  verificationScore: number;
  verificationReason: string;
  verificationProvider: string;
  verifiedAt: Date | null;
};

export function scoreTicket(ticket: TicketForVerification): VerificationDecision {
  let score = 0;
  const reasons: string[] = [];

  if (ticket.title.trim().length >= 8) {
    score += 20;
  } else {
    reasons.push("Title too short");
  }

  if (ticket.venue.trim().length >= 4) {
    score += 20;
  } else {
    reasons.push("Venue missing/too short");
  }

  if (ticket.date.trim().length >= 6) {
    score += 15;
  } else {
    reasons.push("Date missing/too short");
  }

  if (ticket.image.startsWith("http://") || ticket.image.startsWith("https://") || ticket.image.startsWith("/")) {
    score += 15;
  } else {
    reasons.push("Image format invalid");
  }

  if (ticket.priceCents > 0) {
    score += 20;
  } else {
    reasons.push("Invalid price");
  }

  if (ticket.faceValueCents == null || ticket.faceValueCents >= ticket.priceCents) {
    score += 10;
  } else {
    reasons.push("Face value lower than listing price");
  }

  if (ticket.barcodeHash) {
    score += 10;
  } else {
    reasons.push("No barcode evidence provided");
  }

  try {
    const evidence = ticket.verificationEvidence ? JSON.parse(ticket.verificationEvidence) : null;
    const providerConfirmed = !!evidence?.providerConfirmed;
    if (providerConfirmed) {
      score += 15;
    }
  } catch {
    // ignore malformed evidence
  }

  // Decision thresholds
  let verificationStatus: string;
  if (score >= 85) verificationStatus = "VERIFIED";
  else if (score >= 60) verificationStatus = "NEEDS_REVIEW";
  else verificationStatus = "REJECTED";

  return {
    verificationStatus,
    verificationScore: score,
    verificationReason: reasons.length ? reasons.join("; ") : "Auto verification checks passed",
    verificationProvider: "auto-rules-v1",
    verifiedAt: verificationStatus === TicketVerificationStatus.VERIFIED ? new Date() : null,
  };
}

export async function autoVerifyTicketById(prisma: PrismaClient, ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      title: true,
      priceCents: true,
      faceValueCents: true,
      image: true,
      venue: true,
      date: true,
      status: true,
      verificationStatus: true,
      barcodeHash: true,
      verificationEvidence: true,
    },
  });

  if (!ticket) return null;

  // Only auto-process pending tickets.
  if (ticket.verificationStatus !== "PENDING") return ticket;

  const decision = scoreTicket(ticket);

  return prisma.ticket.update({
    where: { id: ticketId },
    data: {
      verificationStatus: decision.verificationStatus,
      verificationScore: decision.verificationScore,
      verificationReason: decision.verificationReason,
      verificationProvider: decision.verificationProvider,
      verifiedAt: decision.verifiedAt,
    },
    select: {
      id: true,
      title: true,
      status: true,
      verificationStatus: true,
      verificationScore: true,
      verificationReason: true,
      verificationProvider: true,
      verifiedAt: true,
      updatedAt: true,
    },
  });
}
