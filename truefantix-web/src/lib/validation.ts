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
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
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
