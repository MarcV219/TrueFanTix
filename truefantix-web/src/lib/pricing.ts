import { prisma } from "./prisma";

export interface PriceRecommendation {
  recommendedPriceCents: number;
  priceRange: {
    min: number;
    max: number;
  };
  confidence: number; // 0-100
  reasoning: string[];
  marketData: {
    averagePrice: number;
    medianPrice: number;
    lowestPrice: number;
    highestPrice: number;
    totalListings: number;
    soldInLast30Days: number;
    demandScore: number; // 0-100
  };
  factors: {
    name: string;
    impact: "positive" | "negative" | "neutral";
    weight: number;
    description: string;
  }[];
}

/**
 * Get AI-powered price recommendation for a ticket
 */
export async function getPriceRecommendation({
  eventTitle,
  venue,
  date,
  row,
  seat,
  faceValueCents,
  sellerId,
}: {
  eventTitle: string;
  venue: string;
  date: string;
  row?: string;
  seat?: string;
  faceValueCents?: number;
  sellerId?: string;
}): Promise<PriceRecommendation> {
  const reasoning: string[] = [];
  const factors: PriceRecommendation["factors"] = [];

  // 1. Find comparable tickets (same event/venue/date)
  const comparableTickets = await prisma.ticket.findMany({
    where: {
      OR: [
        { title: { contains: eventTitle, mode: "insensitive" } },
        { event: { title: { contains: eventTitle, mode: "insensitive" } } },
      ],
      venue: { contains: venue, mode: "insensitive" },
      date: { startsWith: date.split(" ")[0] }, // Match date portion
      status: { in: ["AVAILABLE", "SOLD"] },
      priceCents: { gt: 0 },
    },
    select: {
      priceCents: true,
      faceValueCents: true,
      row: true,
      seat: true,
      status: true,
      soldAt: true,
      createdAt: true,
    },
  });

  // 2. Calculate market statistics
  const availableTickets = comparableTickets.filter(t => t.status === "AVAILABLE");
  const soldTickets = comparableTickets.filter(t => t.status === "SOLD" && t.soldAt);
  
  const prices = comparableTickets.map(t => t.priceCents);
  const availablePrices = availableTickets.map(t => t.priceCents);
  const soldPrices = soldTickets.map(t => t.priceCents);

  const avgPrice = prices.length > 0 
    ? prices.reduce((a, b) => a + b, 0) / prices.length 
    : 0;
  
  const medianPrice = prices.length > 0
    ? calculateMedian(prices)
    : 0;

  const lowestPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const highestPrice = prices.length > 0 ? Math.max(...prices) : 0;

  // Sold in last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const soldInLast30Days = soldTickets.filter(t => 
    t.soldAt && new Date(t.soldAt) > thirtyDaysAgo
  ).length;

  // 3. Calculate demand score (0-100)
  let demandScore = 50; // Base demand

  // More sales = higher demand
  if (soldInLast30Days > 10) {
    demandScore += 20;
    reasoning.push("High recent sales volume indicates strong demand");
    factors.push({
      name: "High Sales Volume",
      impact: "positive",
      weight: 0.2,
      description: `${soldInLast30Days} tickets sold in last 30 days`,
    });
  } else if (soldInLast30Days < 3) {
    demandScore -= 15;
    reasoning.push("Low recent sales suggests soft demand - consider competitive pricing");
    factors.push({
      name: "Low Sales Volume",
      impact: "negative",
      weight: 0.15,
      description: "Few recent sales for this event",
    });
  }

  // Fewer available tickets = higher demand
  if (availableTickets.length < 5) {
    demandScore += 15;
    reasoning.push("Limited inventory available - scarcity drives prices up");
    factors.push({
      name: "Low Inventory",
      impact: "positive",
      weight: 0.15,
      description: `Only ${availableTickets.length} tickets available`,
    });
  } else if (availableTickets.length > 20) {
    demandScore -= 10;
    reasoning.push("High inventory - more competition, consider lower pricing");
    factors.push({
      name: "High Inventory",
      impact: "negative",
      weight: 0.1,
      description: `${availableTickets.length} tickets available - high competition`,
    });
  }

  // 4. Seat quality adjustments
  let seatPremium = 0;
  
  if (row) {
    const rowNumber = parseInt(row.replace(/\D/g, ""));
    if (!isNaN(rowNumber)) {
      if (rowNumber <= 5) {
        seatPremium = 0.25; // Front rows premium
        reasoning.push("Front row seating commands 25% premium");
        factors.push({
          name: "Premium Seating",
          impact: "positive",
          weight: 0.15,
          description: `Row ${row} - front section premium`,
        });
      } else if (rowNumber > 20) {
        seatPremium = -0.15; // Back rows discount
        reasoning.push("Upper section seating - consider 15% discount");
        factors.push({
          name: "Upper Section",
          impact: "negative",
          weight: 0.1,
          description: `Row ${row} - upper section`,
        });
      }
    }
  }

  // 5. Event urgency (how soon is the event)
  const eventDate = new Date(date);
  const daysUntilEvent = Math.floor((eventDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  
  if (daysUntilEvent < 7) {
    demandScore += 20;
    reasoning.push("Event is less than a week away - urgency drives higher prices");
    factors.push({
      name: "Urgency Premium",
      impact: "positive",
      weight: 0.2,
      description: `Only ${daysUntilEvent} days until event`,
    });
  } else if (daysUntilEvent > 60) {
    demandScore -= 10;
    reasoning.push("Event is far in future - early bird pricing recommended");
    factors.push({
      name: "Early Listing",
      impact: "negative",
      weight: 0.1,
      description: `${daysUntilEvent} days until event - early pricing`,
    });
  }

  // 6. Calculate recommended price
  let basePrice = avgPrice;
  
  // If no comparable tickets, use face value + markup
  if (basePrice === 0 && faceValueCents) {
    basePrice = faceValueCents * 1.5; // 50% markup
    reasoning.push(`No comparable tickets found - using face value + 50% markup as baseline`);
  }

  // Apply demand adjustment
  const demandMultiplier = 0.8 + (demandScore / 100) * 0.4; // 0.8x to 1.2x
  let recommendedPrice = basePrice * demandMultiplier;

  // Apply seat premium
  recommendedPrice = recommendedPrice * (1 + seatPremium);

  // Ensure we don't go below face value (if provided)
  if (faceValueCents && recommendedPrice < faceValueCents) {
    recommendedPrice = faceValueCents;
    reasoning.push("Price adjusted to match face value minimum");
  }

  // Round to nearest dollar
  recommendedPrice = Math.round(recommendedPrice / 100) * 100;

  // 7. Calculate price range
  const minPrice = Math.max(
    faceValueCents || 0,
    Math.round(recommendedPrice * 0.8 / 100) * 100
  );
  const maxPrice = Math.round(recommendedPrice * 1.2 / 100) * 100;

  // 8. Calculate confidence
  const confidence = Math.min(95, Math.max(40,
    comparableTickets.length > 10 ? 85 :
    comparableTickets.length > 5 ? 70 :
    comparableTickets.length > 0 ? 55 : 40
  ));

  if (comparableTickets.length < 5) {
    reasoning.push("Limited comparable data - confidence is lower");
  }

  // 9. Seller reputation adjustment
  if (sellerId) {
    const seller = await prisma.seller.findUnique({
      where: { id: sellerId },
      select: { rating: true, reviews: true },
    });

    if (seller && seller.rating >= 4.5 && seller.reviews >= 5) {
      recommendedPrice = Math.round(recommendedPrice * 1.05 / 100) * 100; // 5% premium for trusted sellers
      reasoning.push("Top-rated seller premium (5% added)");
      factors.push({
        name: "Seller Reputation",
        impact: "positive",
        weight: 0.1,
        description: `Top-rated seller (${seller.rating} stars)`,
      });
    }
  }

  return {
    recommendedPriceCents: Math.round(recommendedPrice),
    priceRange: {
      min: minPrice,
      max: maxPrice,
    },
    confidence,
    reasoning,
    marketData: {
      averagePrice: Math.round(avgPrice),
      medianPrice: Math.round(medianPrice),
      lowestPrice,
      highestPrice,
      totalListings: comparableTickets.length,
      soldInLast30Days,
      demandScore,
    },
    factors,
  };
}

function calculateMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Get price trend analysis for an event
 */
export async function getPriceTrends(eventTitle: string, days: number = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const tickets = await prisma.ticket.findMany({
    where: {
      OR: [
        { title: { contains: eventTitle, mode: "insensitive" } },
        { event: { title: { contains: eventTitle, mode: "insensitive" } } },
      ],
      createdAt: { gte: startDate },
      priceCents: { gt: 0 },
    },
    select: {
      priceCents: true,
      createdAt: true,
      soldAt: true,
      status: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by week
  const weeklyData: Record<string, { prices: number[]; sales: number }> = {};

  tickets.forEach(ticket => {
    const week = getWeekKey(new Date(ticket.createdAt));
    if (!weeklyData[week]) {
      weeklyData[week] = { prices: [], sales: 0 };
    }
    weeklyData[week].prices.push(ticket.priceCents);
    if (ticket.status === "SOLD") {
      weeklyData[week].sales++;
    }
  });

  const trend = Object.entries(weeklyData).map(([week, data]) => ({
    week,
    averagePrice: Math.round(data.prices.reduce((a, b) => a + b, 0) / data.prices.length),
    listingCount: data.prices.length,
    salesCount: data.sales,
  }));

  return {
    trend,
    overallDirection: trend.length > 1 && trend[trend.length - 1].averagePrice > trend[0].averagePrice
      ? "increasing"
      : trend.length > 1 && trend[trend.length - 1].averagePrice < trend[0].averagePrice
      ? "decreasing"
      : "stable",
  };
}

function getWeekKey(date: Date): string {
  const year = date.getFullYear();
  const week = Math.floor((date.getTime() - new Date(year, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${year}-W${week}`;
}
