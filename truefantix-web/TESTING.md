# TrueFantix Testing Guide

## Quick Start for Testing

### 1. Database Migration (if schema changes)
```bash
cd /home/marc/.openclaw/workspace/truefantix-web
npx prisma migrate dev --name add_notifications
```

### 2. Start Development Server
```bash
npm run dev
# Server starts on http://localhost:3000
```

### 3. Verify Health Check
```bash
curl http://localhost:3000/api/health
# Should return: { "ok": true, "status": "healthy" }
```

---

## Feature Testing

### Notification System

#### 1. Create Notification Preferences
```bash
curl -X POST http://localhost:3000/api/notifications/preferences \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "type": "ARTIST",
    "value": "Taylor Swift"
  }'
```

#### 2. List Your Notifications
```bash
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### 3. Mark Notifications as Read
```bash
# Mark all as read
curl -X PATCH http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{ "markAll": true }'

# Or mark specific IDs
curl -X PATCH http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{ "ids": ["notification-id-1", "notification-id-2"] }'
```

### Ticket Listing with New Fields

#### Create Ticket with Verification Data
```bash
curl -X POST http://localhost:3000/api/tickets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "title": "Taylor Swift - Toronto Night 1",
    "priceCents": 15000,
    "venue": "Rogers Centre",
    "date": "2026-06-15 7:00 PM",
    "primaryVendor": "Ticketmaster",
    "transferMethod": "Ticketmaster Transfer",
    "barcodeText": "123456789012",
    "verificationImage": "https://example.com/ticket-image.jpg"
  }'
```

### Order Flow Testing

#### 1. Create Order (Checkout)
```bash
curl -X POST http://localhost:3000/api/orders/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Idempotency-Key: unique-key-123" \
  -d '{
    "ticketIds": ["ticket-id-here"],
    "buyerSellerId": "your-seller-id"
  }'
```

#### 2. Submit Transfer Proof (Seller)
```bash
curl -X POST http://localhost:3000/api/orders/transfer-proof \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "orderId": "order-id-here",
    "transferProofType": "Screenshot",
    "transferProofData": "https://example.com/transfer-proof.jpg"
  }'
```

#### 3. Confirm Receipt (Buyer)
```bash
curl -X POST http://localhost:3000/api/orders/confirm-receipt \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "orderId": "order-id-here"
  }'
```

---

## Escrow System Testing

### Verify Escrow Timeout Cron
```bash
# Check that the cron endpoint is accessible
curl http://localhost:3000/api/cron/escrow-timeout \
  -H "x-cron-secret: YOUR_CRON_SECRET"

# Expected response if no expired orders:
# { "ok": true, "expiredOrders": 0, "cancelled": 0 }
```

### Manual Escrow State Check
```bash
curl http://localhost:3000/api/orders/ORDER_ID_HERE/escrow \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Production Deployment Checklist

Before deploying to production:

- [ ] Environment variables set:
  - [ ] `DATABASE_URL` (Neon PostgreSQL)
  - [ ] `STRIPE_SECRET_KEY`
  - [ ] `STRIPE_WEBHOOK_SECRET`
  - [ ] `STRIPE_PUBLISHABLE_KEY` (frontend)
  - [ ] `CRON_SECRET` (for cron job authentication)
  - [ ] `SENDGRID_API_KEY` (optional, for email)
  
- [ ] Database migrated:
  ```bash
  npx prisma migrate deploy
  ```

- [ ] Build passes:
  ```bash
  npm run build
  ```

- [ ] Stripe webhook configured in Stripe Dashboard:
  - Endpoint: `https://yourdomain.com/api/webhooks/stripe`
  - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`

- [ ] Cron job configured (Vercel):
  - Endpoint: `/api/cron/escrow-timeout`
  - Schedule: Every 15 minutes
  - Secret: `CRON_SECRET` header

---

## Troubleshooting

### Build Errors
If TypeScript errors occur:
```bash
# Check types
npx tsc --noEmit

# Common fixes:
# - Ensure all gate.user accesses have null checks
# - Verify Prisma field names match schema
```

### Database Issues
```bash
# Reset database (WARNING: destroys data)
npx prisma migrate reset

# View current schema
npx prisma studio
```

### Notification Testing
To test notifications without Stripe:
1. Use the notification service directly in a test script
2. Or temporarily add a test endpoint that calls `notifyTicketSold()`

---

## API Documentation Summary

### Notification Endpoints
- `GET /api/notifications` - List notifications (paginated)
- `PATCH /api/notifications` - Mark as read (bulk)
- `DELETE /api/notifications` - Delete old notifications
- `GET/POST/DELETE /api/notifications/preferences` - Manage preferences

### Order Endpoints
- `POST /api/orders/checkout` - Create order
- `POST /api/orders/transfer-proof` - Submit transfer proof
- `POST /api/orders/confirm-receipt` - Confirm receipt
- `GET /api/orders/:id/escrow` - Check escrow status

### Ticket Endpoints
- `GET/POST /api/tickets` - List/Create tickets
- `POST /api/tickets/:id/verify` - Submit for verification

---

_Last Updated: February 25, 2026_
