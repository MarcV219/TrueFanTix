import { z } from "zod";

// Common validation schemas
export const schemas = {
  // Ticket schemas
  ticketCreate: z.object({
    title: z.string().min(3).max(200),
    priceCents: z.number().int().positive().max(10000000), // Max $100,000
    faceValueCents: z.number().int().positive().optional(),
    venue: z.string().min(2).max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2} (AM|PM)$/),
    row: z.string().max(20).optional(),
    seat: z.string().max(20).optional(),
    primaryVendor: z.enum(["Ticketmaster", "AXS", "StubHub", "SeatGeek", "Other"]).optional(),
    transferMethod: z.enum(["Ticketmaster Transfer", "AXS Transfer", "PDF Upload", "Mobile Entry", "Other"]).optional(),
    barcodeText: z.string().max(100).optional(),
    verificationImage: z.string().url().max(500).optional(),
    eventId: z.string().optional(),
  }),

  // Order schemas
  orderCheckout: z.object({
    ticketIds: z.array(z.string().cuid()).min(1).max(10),
    buyerSellerId: z.string().cuid(),
    idempotencyKey: z.string().min(10).max(100).optional(),
  }),

  // Payment schemas
  paymentIntent: z.object({
    orderId: z.string().cuid(),
    amount: z.number().positive(),
    currency: z.enum(["USD", "CAD", "EUR", "GBP"]).default("USD"),
  }),

  // User schemas
  userRegister: z.object({
    email: z.string().email().max(255),
    password: z.string().min(8).max(100).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
    streetAddress1: z.string().min(5).max(200),
    city: z.string().min(2).max(100),
    region: z.string().min(2).max(50),
    postalCode: z.string().min(3).max(20),
    country: z.string().length(2),
  }),

  authLogin: z.object({
    emailOrPhone: z.string().trim().min(1).max(255),
    password: z.string().min(1).max(200),
  }),

  authRegister: z.object({
    email: z.string().trim().email().max(255),
    phone: z.string().trim().min(7).max(30),
    password: z.string().min(10).max(100).regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must include at least one letter and one number"),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    displayName: z.string().trim().max(100).optional().nullable(),
    streetAddress1: z.string().trim().min(1).max(200),
    streetAddress2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().min(1).max(50),
    postalCode: z.string().trim().min(1).max(20),
    country: z.string().trim().min(2).max(2),
    acceptTerms: z.literal(true),
    acceptPrivacy: z.literal(true),
  }),

  forgotPasswordRequest: z.object({
    email: z.string().trim().email().max(255),
  }),

  forgotPasswordReset: z.object({
    token: z.string().trim().min(16).max(256),
    userId: z.string().trim().cuid(),
    newPassword: z.string().min(8).max(100),
  }),

  verificationCodeConfirm: z.object({
    code: z.string().trim().regex(/^\d{6}$/),
  }),

  // Notification preference schemas
  notificationPreference: z.object({
    type: z.enum(["ARTIST", "TEAM", "VENUE", "CITY", "EVENT_TYPE", "PRICE_DROP"]),
    value: z.string().min(1).max(100),
  }),

  // Search schemas
  searchQuery: z.object({
    q: z.string().min(1).max(100),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(50).default(20),
    sortBy: z.enum(["relevance", "price_asc", "price_desc", "date_asc", "date_desc"]).default("relevance"),
    filters: z.object({
      minPrice: z.number().nonnegative().optional(),
      maxPrice: z.number().nonnegative().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      venue: z.string().optional(),
    }).optional(),
  }),

  // Transfer proof schemas
  transferProof: z.object({
    orderId: z.string().cuid(),
    transferProofType: z.enum(["Screenshot", "Transfer ID", "Email Confirmation", "Other"]),
    transferProofData: z.string().url().max(500),
  }),

  // Profile update schemas
  profileUpdate: z.object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    displayName: z.string().trim().max(100).optional().nullable(),
    bio: z.string().trim().max(500).optional().nullable(),
    phone: z.string().trim().min(7).max(30).optional(),
    streetAddress1: z.string().trim().min(1).max(200).optional(),
    streetAddress2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().min(1).max(100).optional(),
    region: z.string().trim().min(1).max(50).optional(),
    postalCode: z.string().trim().min(1).max(20).optional(),
    country: z.string().trim().min(2).max(2).optional(),
  }),

  // Password change schema
  passwordChange: z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(10).max(100).regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must include at least one letter and one number"),
  }),

  // Early access signup schema
  earlyAccessSignup: z.object({
    email: z.string().trim().email().max(255),
    source: z.string().trim().max(80).optional(),
  }),

  // Waitlist signup schema
  waitlistSignup: z.object({
    eventId: z.string().cuid(),
    maxPriceCents: z.number().int().positive().optional(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),

  // Price alert schema
  priceAlert: z.object({
    ticketId: z.string().cuid().optional(),
    eventQuery: z.string().trim().min(1).max(200).optional(),
    targetPriceCents: z.number().int().positive().optional(),
  }),

  // Forum schemas
  forumThreadCreate: z.object({
    title: z.string().trim().min(5).max(200),
    content: z.string().trim().min(10).max(5000),
    category: z.string().trim().min(1).max(50).optional(),
  }),

  forumPostCreate: z.object({
    threadId: z.string().cuid(),
    content: z.string().trim().min(1).max(5000),
    parentId: z.string().cuid().optional().nullable(),
  }),

  // Review schema
  reviewCreate: z.object({
    sellerId: z.string().cuid(),
    orderId: z.string().cuid(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(10).max(1000).optional().nullable(),
  }),

  // Referral schema
  referralCreate: z.object({
    email: z.string().trim().email().max(255),
  }),

  // Admin action schemas
  adminOrderAction: z.object({
    orderId: z.string().cuid(),
    action: z.enum(["capture", "deliver", "complete", "reverse"]),
    reason: z.string().trim().min(5).max(500).optional(),
  }),

  adminTicketVerification: z.object({
    ticketId: z.string().cuid(),
    status: z.enum(["VERIFIED", "REJECTED", "NEEDS_REVIEW"]),
    reason: z.string().trim().max(500).optional().nullable(),
    score: z.number().int().min(0).max(100).optional(),
  }),

  adminForumModeration: z.object({
    postId: z.string().cuid().optional(),
    threadId: z.string().cuid().optional(),
    action: z.enum(["hide", "show", "lock", "unlock", "delete"]),
    reason: z.string().trim().min(5).max(500),
  }),

  // Search query params schema (for GET requests)
  ticketSearchQuery: z.object({
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sortBy: z.enum(["relevance", "price_asc", "price_desc", "date_asc", "date_desc", "newest"]).default("relevance"),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    venue: z.string().trim().max(200).optional(),
    status: z.enum(["AVAILABLE", "SOLD", "WITHDRAWN"]).default("AVAILABLE"),
    sellerId: z.string().cuid().optional(),
  }),

  // Ticket purchase schema
  ticketPurchase: z.object({
    buyerSellerId: z.string().cuid(),
    idempotencyKey: z.string().min(10).max(100).optional(),
  }),

  // Escrow action schemas
  escrowDeposit: z.object({
    ticketId: z.string().cuid(),
    proofData: z.string().url().max(500).optional(),
  }),

  escrowRelease: z.object({
    orderId: z.string().cuid(),
    releaseType: z.enum(["ticket", "back"]),
  }),

  // Seller onboarding schema
  sellerOnboardingStart: z.object({
    returnUrl: z.string().url().max(500).optional(),
    refreshUrl: z.string().url().max(500).optional(),
  }),

  // Notification preferences schema
  notificationPreferencesUpdate: z.object({
    emailEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional(),
    marketingEmails: z.boolean().optional(),
    priceDropAlerts: z.boolean().optional(),
    eventReminders: z.boolean().optional(),
  }),
};

// Sanitization utilities
export function sanitizeHtml(input: string): string {
  // Basic XSS prevention
  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

export function sanitizeInput<T>(data: T, schema: z.ZodSchema<T>): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  return {
    success: false,
    errors: result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

// Validation middleware helper
export function validateRequest<T>(schema: z.ZodSchema<T>) {
  return async (req: Request): Promise<{ success: true; data: T } | { success: false; response: Response }> => {
    try {
      const body = await req.json();
      const result = sanitizeInput(body, schema);
      
      if (result.success) {
        return { success: true, data: result.data };
      }
      
      return {
        success: false,
        response: new Response(
          JSON.stringify({
            ok: false,
            error: "VALIDATION_ERROR",
            message: "Invalid request data",
            details: result.errors,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        ),
      };
    } catch {
      return {
        success: false,
        response: new Response(
          JSON.stringify({
            ok: false,
            error: "INVALID_JSON",
            message: "Could not parse request body",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
  };
}
