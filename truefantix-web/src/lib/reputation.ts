import { prisma } from "./prisma";

export interface ReputationScore {
  overall: number;        // 0-100
  trustworthiness: number; // 0-100
  responsiveness: number;  // 0-100
  quality: number;        // 0-100
  level: "NEW" | "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND";
  badges: string[];
}

export interface FraudRiskScore {
  score: number;          // 0-100 (higher = more risky)
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  factors: RiskFactor[];
  recommendations: string[];
}

interface RiskFactor {
  name: string;
  weight: number;
  score: number;
  description: string;
}

/**
 * Calculate comprehensive seller reputation score
 */
export async function calculateSellerReputation(sellerId: string): Promise<ReputationScore> {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: {
      tickets: {
        where: { status: "SOLD" },
        select: {
          createdAt: true,
          soldAt: true,
          verificationStatus: true,
          priceCents: true,
        },
      },
      orders: {
        where: { status: { in: ["COMPLETED", "CANCELLED"] } },
        select: {
          status: true,
          createdAt: true,
          buyerConfirmationStatus: true,
          disputeWindowEndsAt: true,
        },
      },
      creditTransactions: {
        select: { type: true, amountCredits: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      badges: true,
    },
  });

  if (!seller) {
    throw new Error("Seller not found");
  }

  // Calculate component scores
  const trustworthiness = await calculateTrustworthiness(seller);
  const responsiveness = await calculateResponsiveness(seller);
  const quality = await calculateQuality(seller);

  // Weighted overall score
  const overall = Math.round(
    trustworthiness * 0.4 +
    responsiveness * 0.3 +
    quality * 0.3
  );

  // Determine level based on score and activity
  const level = determineSellerLevel(overall, seller.tickets.length);

  return {
    overall,
    trustworthiness,
    responsiveness,
    quality,
    level,
    badges: seller.badges.map(b => b.name),
  };
}

async function calculateTrustworthiness(seller: any): Promise<number> {
  let score = 50; // Base score

  // Account age bonus
  const accountAgeDays = Math.floor((Date.now() - new Date(seller.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  score += Math.min(accountAgeDays / 10, 15); // Max +15 for 150+ days

  // Successful sales
  const successfulSales = seller.tickets.filter((t: any) => t.status === "SOLD").length;
  score += Math.min(successfulSales * 2, 20); // Max +20 for 10+ sales

  // Verification status
  if (seller.status === "APPROVED") score += 10;

  // Dispute history (penalty)
  const disputedOrders = seller.orders.filter((o: any) => o.status === "DISPUTED").length;
  score -= disputedOrders * 10;

  // Credit balance (indicates successful transactions)
  if (seller.creditBalanceCredits > 0) score += 5;

  return Math.max(0, Math.min(100, score));
}

async function calculateResponsiveness(seller: any): Promise<number> {
  let score = 60; // Base score

  // Check transfer proof submission times
  const ordersWithProof = await prisma.order.findMany({
    where: {
      sellerId: seller.id,
      transferProofType: { not: null },
    },
    select: {
      createdAt: true,
    },
  });

  // Quick response bonus
  const quickResponses = ordersWithProof.filter((o: any) => {
    const hoursToRespond = (new Date(o.createdAt).getTime() - new Date(o.createdAt).getTime()) / (1000 * 60 * 60);
    return hoursToRespond < 24;
  }).length;

  score += Math.min(quickResponses * 5, 25);

  // View count activity
  const totalViews = seller.tickets.reduce((sum: number, t: any) => sum + t.viewCount, 0);
  score += Math.min(totalViews / 100, 10);

  // Listing frequency
  const recentListings = seller.tickets.filter((t: any) => {
    const daysAgo = (Date.now() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo < 30;
  }).length;
  score += Math.min(recentListings * 2, 10);

  return Math.max(0, Math.min(100, score));
}

async function calculateQuality(seller: any): Promise<number> {
  let score = 50; // Base score

  // Verification rate
  const verifiedTickets = seller.tickets.filter((t: any) => t.verificationStatus === "VERIFIED").length;
  const totalTickets = seller.tickets.length;
  if (totalTickets > 0) {
    score += (verifiedTickets / totalTickets) * 30;
  }

  // Average ticket price (higher prices suggest quality)
  const avgPrice = seller.tickets.reduce((sum: number, t: any) => sum + t.priceCents, 0) / totalTickets || 0;
  if (avgPrice > 10000) score += 10; // Above $100 average

  // Completion rate
  const completedOrders = seller.orders.filter((o: any) => o.status === "COMPLETED").length;
  const totalOrders = seller.orders.length;
  if (totalOrders > 0) {
    score += (completedOrders / totalOrders) * 20;
  }

  return Math.max(0, Math.min(100, score));
}

function determineSellerLevel(score: number, totalSales: number): ReputationScore["level"] {
  if (totalSales < 1) return "NEW";
  if (score >= 90 && totalSales >= 50) return "DIAMOND";
  if (score >= 80 && totalSales >= 25) return "PLATINUM";
  if (score >= 70 && totalSales >= 10) return "GOLD";
  if (score >= 60 && totalSales >= 5) return "SILVER";
  return "BRONZE";
}

/**
 * Calculate fraud risk score for a transaction
 */
export async function calculateFraudRisk({
  sellerId,
  buyerId,
  ticketId,
  amountCents,
}: {
  sellerId: string;
  buyerId: string;
  ticketId: string;
  amountCents: number;
}): Promise<FraudRiskScore> {
  const factors: RiskFactor[] = [];
  const recommendations: string[] = [];

  // Check seller reputation
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: {
      tickets: { where: { status: "SOLD" } },
      orders: { where: { status: "DISPUTED" } },
    },
  });

  if (!seller) {
    factors.push({
      name: "Unknown Seller",
      weight: 0.3,
      score: 80,
      description: "Seller profile not found or inactive",
    });
  } else {
    // New seller risk
    const accountAgeDays = Math.floor((Date.now() - new Date(seller.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    if (accountAgeDays < 7) {
      factors.push({
        name: "New Seller",
        weight: 0.2,
        score: 60,
        description: `Account created ${accountAgeDays} days ago`,
      });
      recommendations.push("Verify seller identity manually for new accounts");
    }

    // Dispute history
    const disputeRate = seller.orders.length / (seller.tickets.length || 1);
    if (disputeRate > 0.1) {
      factors.push({
        name: "High Dispute Rate",
        weight: 0.25,
        score: 70,
        description: `${Math.round(disputeRate * 100)}% of orders have disputes`,
      });
      recommendations.push("Review seller's dispute history before approval");
    }

    // Low sales volume with high value
    if (seller.tickets.length < 3 && amountCents > 50000) {
      factors.push({
        name: "High Value / Low Experience",
        weight: 0.15,
        score: 50,
        description: "High-value ticket from inexperienced seller",
      });
      recommendations.push("Request additional verification for high-value listings");
    }
  }

  // Check ticket details
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      verificationStatus: true,
      verificationImage: true,
      priceCents: true,
      faceValueCents: true,
      createdAt: true,
    },
  });

  if (ticket) {
    // Unverified ticket risk
    if (ticket.verificationStatus === "PENDING") {
      factors.push({
        name: "Unverified Ticket",
        weight: 0.15,
        score: 40,
        description: "Ticket has not been verified",
      });
    }

    // Missing verification image
    if (!ticket.verificationImage) {
      factors.push({
        name: "No Proof Image",
        weight: 0.1,
        score: 30,
        description: "No verification image provided",
      });
    }

    // Suspicious pricing
    if (ticket.faceValueCents && ticket.priceCents < ticket.faceValueCents * 0.3) {
      factors.push({
        name: "Suspicious Pricing",
        weight: 0.2,
        score: 65,
        description: "Price is significantly below face value",
      });
      recommendations.push("Flag for manual review - unusually low price");
    }

    // Very recent listing
    const hoursSinceListed = (Date.now() - new Date(ticket.createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceListed < 1) {
      factors.push({
        name: "Fresh Listing",
        weight: 0.05,
        score: 20,
        description: "Listed less than 1 hour ago",
      });
    }
  }

  // Calculate weighted score
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const weightedScore = totalWeight > 0
    ? factors.reduce((sum, f) => sum + (f.score * f.weight), 0) / totalWeight
    : 0;

  const finalScore = Math.round(weightedScore);

  // Determine risk level
  let riskLevel: FraudRiskScore["riskLevel"];
  if (finalScore >= 70) riskLevel = "CRITICAL";
  else if (finalScore >= 50) riskLevel = "HIGH";
  else if (finalScore >= 30) riskLevel = "MEDIUM";
  else riskLevel = "LOW";

  if (recommendations.length === 0) {
    recommendations.push("Transaction appears normal - standard processing");
  }

  return {
    score: finalScore,
    riskLevel,
    factors,
    recommendations,
  };
}

/**
 * Update seller badge based on achievements
 */
export async function updateSellerBadges(sellerId: string) {
  const badgesToAdd: string[] = [];

  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: {
      tickets: { where: { status: "SOLD" } },
      badges: true,
    },
  });

  if (!seller) return;

  const currentBadges = seller.badges.map(b => b.name);

  // Volume badges
  if (seller.tickets.length >= 1 && !currentBadges.includes("First Sale")) {
    badgesToAdd.push("First Sale");
  }
  if (seller.tickets.length >= 10 && !currentBadges.includes("Power Seller")) {
    badgesToAdd.push("Power Seller");
  }
  if (seller.tickets.length >= 50 && !currentBadges.includes("Top Seller")) {
    badgesToAdd.push("Top Seller");
  }

  // Verification badge
  const verifiedTickets = seller.tickets.filter(t => t.verificationStatus === "VERIFIED").length;
  if (verifiedTickets >= 5 && !currentBadges.includes("Verified Pro")) {
    badgesToAdd.push("Verified Pro");
  }

  // Add new badges
  for (const badgeName of badgesToAdd) {
    await prisma.sellerBadge.create({
      data: {
        sellerId,
        name: badgeName,
      },
    });
  }

  return badgesToAdd;
}
