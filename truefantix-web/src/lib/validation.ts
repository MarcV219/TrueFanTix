import { z } from "zod";

// Common validation schemas
export const schemas = {
  // Ticket schemas
  // NOTE: This is a generic ticket schema used by some parts of the app.
  ticketCreate: z.object({
    title: z.string().min(3).max(200),
    priceCents: z.number().int().positive().max(10000000), // Max $100,000
    faceValueCents: z.number().int().positive().optional(),
    venue: z.string().min(2).max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2} (AM|PM)$/),
    section: z.string().max(20).optional(),
    row: z.string().max(20).optional(),
    seat: z.string().max(20).optional(),
    primaryVendor: z.enum(["Ticketmaster", "AXS", "StubHub", "SeatGeek", "Other"]).optional(),
    transferMethod: z.enum(["Ticketmaster Transfer", "AXS Transfer", "PDF Upload", "Mobile Entry", "Other"]).optional(),
    barcodeText: z.string().max(100).optional(),
    verificationImage: z.string().url().max(500).optional(),
    eventId: z.string().optional(),
  }),

  // Used by POST /api/tickets (seller creates a listing)
  ticketCreateApi: z.object({
    title: z.string().trim().min(1).max(120),
    priceCents: z.number().int().positive().max(10_000_000),
    currency: z.enum(["CAD", "USD"]).default("CAD"),
    faceValueCents: z.number().int().nonnegative().optional().nullable(),
    adminFeePaidCents: z.number().int().nonnegative().max(10_000_000).optional(),
    purchaseQuantity: z.number().int().positive().max(20).optional(),

    // Optional client-provided image (server will try to auto-fetch a relevant one first)
    image: z.string().trim().url().max(2048).optional().nullable(),

    venue: z.string().trim().min(1).max(200),
    date: z.string().trim().min(1).max(100),
    section: z.string().trim().max(80).optional().nullable(),
    row: z.string().trim().max(80).optional().nullable(),
    seat: z.string().trim().max(80).optional().nullable(),

    // Seller-selected category for marketplace tags and filters
    eventTypeOverride: z.enum([
      "concert",
      "theatre",
      "comedy",
      "conference",
      "festival",
      "gala",
      "opera",
      "workshop",
      "other",
      "sports-basketball",
      "sports-hockey",
      "sports-baseball",
      "sports-football",
      "sports-soccer",
      "sports-lacrosse",
      "sports-other",
    ]),
    catalogRequestType: z.enum(["ARTIST", "TEAM", "SPORT", "SHOW", "OTHER"]).optional(),

    eventId: z.string().trim().cuid().optional().nullable(),

    barcodeData: z.string().trim().min(8).max(8192).optional().nullable(),
    barcodeType: z.string().trim().max(100).optional().nullable(),

    primaryVendor: z.string().trim().max(80).optional().nullable(),
    transferMethod: z.string().trim().max(80).optional().nullable(),
    barcodeText: z.string().trim().max(255).optional().nullable(),
    verificationImage: z
      .string()
      .trim()
      .max(4_500_000)
      .refine(
        (value) =>
          !value ||
          /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(value) ||
          /^data:application\/pdf;base64,/i.test(value) ||
          /^https?:\/\//i.test(value),
        {
          message: "verificationImage must be a JPG, PNG, WebP, GIF, PDF receipt upload, or URL.",
        }
      )
      .optional()
      .nullable(),
    receiptFileName: z.string().trim().max(255).optional().nullable(),
    sellerConfirmedReceiptValues: z.boolean().optional(),
    requestManualReview: z.boolean().optional(),
    supportReviewNote: z.string().trim().max(1000).optional().nullable(),
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

  // Used by POST /api/payments/create-intent
  paymentsCreateIntent: z.object({
    orderId: z.string().trim().cuid(),
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
    // Strict E.164: must include leading + and country code, e.g. +14165550123
    phone: z.string().trim().regex(/^\+[1-9]\d{1,14}$/, "Phone must be in international format with country code (e.g., +14165550123)"),
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

  // Used by POST /api/auth/verify-email
  authVerifyEmailSend: z
    .object({
      email: z.string().trim().email().max(255).optional(),
      userId: z.string().trim().cuid().optional(),
    })
    .refine((v) => !!v.email || !!v.userId, {
      message: "Email or userId required.",
      path: ["email"],
    }),

  // Used by GET /api/auth/verify-email
  authVerifyEmailConfirm: z.object({
    token: z.string().trim().min(10).max(256),
    userId: z.string().trim().cuid(),
  }),

  // Used by POST /api/auth/reset-password
  authResetPassword: z.object({
    token: z.string().trim().min(16).max(256),
    email: z.string().trim().email().max(255),
    password: z
      .string()
      .min(10)
      .max(100)
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must include at least one letter and one number"),
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
  // (Legacy/strict) expects proofData to be a URL
  transferProof: z.object({
    orderId: z.string().cuid(),
    transferProofType: z.enum(["Screenshot", "Email Confirmation", "Other"]),
    transferProofData: z.string().url().max(500),
  }),

  // Used by POST /api/orders/transfer-proof
  // proofData can be a URL or supporting confirmation text.
  orderTransferProof: z.object({
    orderId: z.string().trim().cuid(),
    transferProofType: z.enum(["Screenshot", "Email Confirmation", "Other"]),
    transferProofData: z.string().trim().max(2048).optional().nullable(),
    transferProofImage: z
      .string()
      .trim()
      .max(3_000_000)
      .refine(
        (value) =>
          !value ||
          /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(value) ||
          /^data:application\/pdf;base64,/i.test(value),
        {
          message: "transferProofImage must be a JPG, PNG, WebP, GIF, or PDF upload.",
        }
      )
      .optional()
      .nullable(),
    transferProofFileName: z.string().trim().max(255).optional().nullable(),
  }),

  // Used by POST /api/orders/confirm-receipt
  orderConfirmReceipt: z.object({
    orderId: z.string().trim().cuid(),
  }),

  // Used by POST /api/orders/dispute
  orderOpenDispute: z.object({
    orderId: z.string().trim().cuid(),
    ticketIds: z.array(z.string().trim().cuid()).min(1).max(100).refine(
      (ticketIds) => new Set(ticketIds).size === ticketIds.length,
      { message: "ticketIds must not contain duplicates." }
    ),
    reason: z.string().trim().min(10).max(2000),
    evidence: z.string().trim().max(2048).optional().nullable(),
    evidenceFiles: z
      .array(
        z.object({
          data: z
            .string()
            .trim()
            .max(3_000_000)
            .refine(
              (value) =>
                /^data:(image\/(jpeg|jpg|png|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document));base64,/i.test(
                  value
                ),
              { message: "Evidence must be a JPG, PNG, WebP, PDF, DOC, or DOCX file." }
            ),
          fileName: z.string().trim().min(1).max(255),
        })
      )
      .max(5)
      .refine(
        (files) => files.reduce((total, file) => total + file.data.length, 0) <= 2_700_000,
        { message: "Supporting documents must be 2 MB or smaller in total." }
      )
      .optional()
      .default([]),
  }),

  // Used by POST /api/orders/dispute/evidence
  orderDisputeEvidence: z.object({
    orderId: z.string().trim().cuid(),
    comments: z.string().trim().max(2000).optional().default(""),
    evidenceFiles: z
      .array(
        z.object({
          data: z.string().trim().max(3_000_000).refine(
            (value) => /^data:(image\/(jpeg|jpg|png|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document));base64,/i.test(value),
            { message: "Evidence must be a JPG, PNG, WebP, PDF, DOC, or DOCX file." }
          ),
          fileName: z.string().trim().min(1).max(255),
        })
      )
      .max(5)
      .refine((files) => files.reduce((total, file) => total + file.data.length, 0) <= 2_700_000, {
        message: "Supporting documents must be 2 MB or smaller in total.",
      })
      .optional()
      .default([]),
  }).refine((value) => value.comments.length > 0 || value.evidenceFiles.length > 0, {
    message: "Add comments or at least one supporting document.",
  }),

  // Used by POST /api/orders/dispute/cancel
  orderCancelDispute: z.object({
    orderId: z.string().trim().cuid(),
    satisfactorilyResolved: z.literal(true),
  }),

  // Used by POST /api/admin/orders/[id]/resolve-dispute
  adminResolveDispute: z.object({
    action: z.enum(["RELEASE_PAYOUT", "MARK_REFUND_REQUIRED", "KEEP_UNDER_REVIEW"]),
    note: z.string().trim().min(3).max(2000),
  }),

  // Used by POST /api/admin/orders/[id]/request-information
  adminRequestDisputeInformation: z.object({
    recipient: z.enum(["BUYER", "SELLER", "BOTH"]),
    message: z.string().trim().min(3).max(3000),
  }),

  // Used by POST /api/admin/orders/[id]/review-transfer-proof
  adminReviewTransferProof: z.object({
    action: z.enum(["APPROVE", "REJECT", "REQUEST_INFORMATION"]),
    note: z.string().trim().min(3).max(3000),
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

  // Used by PATCH /api/account/profile (keeps existing API constraints)
  accountProfileUpdate: z.object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    displayName: z.string().trim().max(100).optional().nullable(),
    phone: z.string().trim().min(7).max(50).optional(),
    streetAddress1: z.string().trim().min(1).max(200).optional(),
    streetAddress2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().min(1).max(100).optional(),
    region: z.string().trim().min(1).max(100).optional(),
    postalCode: z.string().trim().min(1).max(20).optional(),
    country: z.string().trim().min(1).max(100).optional(),
  }),

  // Used by POST /api/account/delete
  accountDelete: z.object({
    password: z.string().min(1).max(200),
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

  // Used by POST /api/waitlist (maxPrice in dollars)
  waitlistCreateApi: z.object({
    eventId: z.string().trim().cuid(),
    maxPrice: z.number().positive().max(100000).optional(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),

  // Used by DELETE /api/waitlist
  waitlistDeleteQuery: z.object({
    id: z.string().trim().cuid(),
  }),

  // Price alert schema
  priceAlert: z.object({
    ticketId: z.string().cuid().optional(),
    eventQuery: z.string().trim().min(1).max(200).optional(),
    targetPriceCents: z.number().int().positive().optional(),
  }),

  // Used by POST /api/price-alerts (targetPrice in dollars)
  priceAlertCreateApi: z
    .object({
      ticketId: z.string().trim().cuid().optional(),
      eventQuery: z.string().trim().min(1).max(200).optional(),
      targetPrice: z.number().positive().max(100000).optional(),
    })
    .refine((v) => !!v.ticketId || !!v.eventQuery, {
      message: "Provide ticketId or eventQuery.",
      path: ["ticketId"],
    }),

  // Used by DELETE /api/price-alerts
  priceAlertDeleteQuery: z.object({
    id: z.string().trim().cuid(),
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

  // Used by POST /api/tickets/[id]/verify (ticketId comes from route param)
  adminTicketVerificationById: z.object({
    status: z.enum(["PENDING", "VERIFIED", "REJECTED", "NEEDS_REVIEW"]),
    reason: z.string().trim().max(500).optional().nullable(),
    score: z.number().int().min(0).max(100).optional().nullable(),
    provider: z.string().trim().max(80).optional().nullable(),
  }),

  // Used by POST /api/tickets/verify/pending
  ticketVerifyPending: z.object({
    take: z.number().int().min(1).max(200).optional().default(25),
  }),

  // Used by POST /api/tickets/[id]/escrow/deposit
  ticketEscrowDeposit: z.object({
    provider: z.string().trim().max(50).optional().default("MANUAL"),
    providerRef: z.string().trim().max(200).optional().nullable(),
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

  // Used by POST /api/tickets/[id]/purchase (query string)
  ticketPurchaseQuery: z.object({
    buyerSellerId: z.string().trim().cuid(),
    idempotencyKey: z.string().trim().min(10).max(100).optional(),
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

  // Used by POST /api/notifications/preferences
  notificationPreferenceCreateApi: z.object({
    type: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(80),
    catalogEntityId: z.string().trim().cuid().optional(),
  }),

  // Used by PATCH /api/notifications/preferences
  notificationPreferencesSettingsApi: z.object({
    notificationRadiusKm: z.number().int().min(1).max(5000).nullable(),
    notificationRadiusUnit: z.enum(["KM", "MI"]).optional(),
  }),

  // Used by DELETE /api/notifications/preferences
  notificationPreferenceDeleteApi: z.object({
    id: z.string().trim().cuid(),
  }),

  // Used by POST /api/catalog/requests
  catalogRequestCreateApi: z.object({
    type: z.enum(["ARTIST", "TEAM", "VENUE", "CITY", "SPORT", "SHOW", "OTHER"]),
    value: z.string().trim().min(2).max(120),
    notes: z.string().trim().max(1000).optional().nullable(),
  }),

  // Used by PATCH /api/admin/catalog-requests/[id]
  catalogRequestReviewApi: z
    .object({
      status: z.enum(["FULFILLED", "REJECTED", "NEEDS_CLARIFICATION"]),
      catalogEntityId: z.string().trim().cuid().optional().nullable(),
      adminNotes: z.string().trim().max(1000).optional().nullable(),
    })
    .refine((v) => v.status !== "FULFILLED" || !!v.catalogEntityId, {
      message: "catalogEntityId is required when fulfilling a catalog request.",
      path: ["catalogEntityId"],
    }),

  // Used by PATCH /api/notifications
  notificationsPatchApi: z
    .object({
      ids: z.array(z.string().trim().cuid()).min(1).max(500).optional(),
      markAll: z.boolean().optional(),
    })
    .refine((v) => v.markAll === true || (Array.isArray(v.ids) && v.ids.length > 0), {
      message: "Provide 'ids' array or set 'markAll' to true.",
      path: ["ids"],
    }),

  reviewCreateApi: z.object({
    orderId: z.string().trim().cuid(),
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().max(200).optional().nullable(),
    content: z.string().trim().min(1).max(5000),
    aspects: z
      .object({
        communication: z.number().int().min(1).max(5).optional(),
        accuracy: z.number().int().min(1).max(5).optional(),
        delivery: z.number().int().min(1).max(5).optional(),
      })
      .optional(),
  }),

  reviewUpdateApi: z
    .object({
      reviewId: z.string().trim().cuid(),
      rating: z.number().int().min(1).max(5).optional(),
      title: z.string().trim().max(200).optional().nullable(),
      content: z.string().trim().min(1).max(5000).optional(),
    })
    .refine((v) => v.rating !== undefined || v.title !== undefined || v.content !== undefined, {
      message: "Provide at least one field to update.",
      path: ["reviewId"],
    }),

  reviewDeleteQuery: z.object({ id: z.string().trim().cuid() }),
  messageDeleteQuery: z.object({ id: z.string().trim().cuid() }),

  messageCreateApi: z
    .object({
      conversationId: z.string().trim().cuid().optional(),
      orderId: z.string().trim().cuid().optional(),
      recipientId: z.string().trim().cuid().optional(),
      content: z.string().trim().min(1).max(5000),
      attachments: z
        .array(
          z.object({
            type: z.string().trim().min(1).max(40),
            url: z.string().trim().url().max(2000),
            name: z.string().trim().max(255).optional(),
          })
        )
        .max(10)
        .optional(),
    })
    .refine((v) => !!v.conversationId || !!v.orderId || !!v.recipientId, {
      message: "content and recipient required",
      path: ["conversationId"],
    }),

  communityCommentCreateApi: z
    .object({
      body: z.string().trim().min(1).max(2000),
      parentId: z.string().trim().cuid().optional().nullable(),
      ticketId: z.string().trim().cuid().optional().nullable(),
      eventId: z.string().trim().cuid().optional().nullable(),
    })
    .refine((v) => !!v.parentId || !!v.ticketId || !!v.eventId, {
      message: "Choose what you are commenting on (ticketId or eventId) or provide parentId to reply.",
      path: ["parentId"],
    }),

  forumPostCreateApi: z.object({
    threadId: z.string().trim().cuid(),
    body: z.string().trim().min(1).max(8000),
    parentId: z.string().trim().cuid().optional().nullable(),
  }),

  forumThreadCreateApi: z.object({
    title: z.string().trim().min(5).max(140),
    topicType: z.enum(["ARTIST", "TEAM", "SHOW", "OTHER"]).optional(),
    topic: z.string().trim().max(140).optional().nullable(),
    body: z.string().trim().min(5).max(8000),
  }),

  forumLockApi: z.object({
    locked: z.boolean(),
    reason: z.string().trim().max(300).optional().nullable(),
  }),

  forumVisibilityApi: z.object({
    visibility: z.enum(["VISIBLE", "HIDDEN", "DELETED"]),
    reason: z.string().trim().max(300).optional().nullable(),
  }),

  referralClaimApi: z.object({
    referralCode: z.string().trim().min(4).max(40),
    newUserId: z.string().trim().cuid(),
  }),

  referralCompleteApi: z.object({
    referredId: z.string().trim().cuid(),
    orderAmount: z.number().positive().optional(),
  }),

  sellerCreateApi: z.object({
    name: z.string().trim().min(1).max(120),
    rating: z.number().min(0).max(5).optional(),
    reviews: z.number().int().min(0).optional(),
    badges: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  }),

  sellerAccessTokensAdjustApi: z.object({
    sellerId: z.string().trim().cuid(),
    amount: z.number().int().refine((n) => n !== 0, { message: "amount cannot be 0" }),
    reason: z.string().trim().min(1).max(500),
    ticketId: z.string().trim().cuid().optional().nullable(),
  }),

  sellerFraudCheckApi: z.object({
    buyerId: z.string().trim().cuid().optional(),
    ticketId: z.string().trim().cuid(),
    amountCents: z.number().int().positive(),
  }),

  pricingRecommendationQuery: z.object({
    eventTitle: z.string().trim().min(1).max(200),
    venue: z.string().trim().min(1).max(200),
    date: z.string().trim().min(1).max(80),
    row: z.string().trim().max(40).optional(),
    seat: z.string().trim().max(40).optional(),
    faceValue: z.coerce.number().nonnegative().optional(),
  }),

  pricingTrendsApi: z.object({
    eventTitle: z.string().trim().min(1).max(200),
    days: z.number().int().min(1).max(365).optional(),
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

// Like validateRequest, but tolerates empty body and treats it as {}
export function validateOptionalRequest<T>(schema: z.ZodSchema<T>) {
  return async (req: Request): Promise<{ success: true; data: T } | { success: false; response: Response }> => {
    try {
      const raw = await req.text();
      const body = raw.trim() ? JSON.parse(raw) : {};
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
