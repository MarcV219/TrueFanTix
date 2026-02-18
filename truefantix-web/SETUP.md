# TrueFanTix MVP Setup Guide

## Environment Variables

Copy `.env.local` to `.env.local` and fill in the values:

```bash
# Required
DATABASE_URL=file:./prisma/dev.db
VERIFICATION_SECRET=your-super-secret-32-char-minimum-string

# Stripe (Required for payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Setting Up Stripe

### 1. Create Stripe Account
- Go to https://stripe.com and create an account
- Switch to Test mode

### 2. Get API Keys
- Go to Developers → API Keys
- Copy **Publishable key** (starts with `pk_test_`)
- Copy **Secret key** (starts with `sk_test_`)

### 3. Setup Webhook
- Go to Developers → Webhooks
- Add endpoint: `http://localhost:3000/api/webhooks/stripe` (local) or your production URL
- Select events:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `charge.refunded`
- Copy the **Signing secret** (starts with `whsec_`)

### 4. Test Webhook Locally (Optional)
Install Stripe CLI:
```bash
# macOS
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local dev
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

### 5. Email Setup (SendGrid)

For production, you need to set up SendGrid for email notifications:

1. **Create SendGrid Account**
   - Go to https://sendgrid.com and sign up
   - Verify your sender identity (domain or single sender)

2. **Generate API Key**
   - Go to Settings → API Keys
   - Create API Key with "Mail Send" permissions
   - Copy the key (starts with `SG.`)

3. **Add to Environment**
   ```bash
   SENDGRID_API_KEY=SG.your-api-key-here
   FROM_EMAIL=noreply@yourdomain.com
   ```

4. **Without SendGrid (DEV Mode)**
   - If `SENDGRID_API_KEY` is not set, emails will be logged to the console
   - This is useful for development but won't actually send emails

## Testing Payment Flow

### Test Cards
Use these Stripe test card numbers:

| Card Number | Description |
|-------------|-------------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 0002` | Declined card |
| `4000 0000 0000 9995` | Insufficient funds |

Use any future date for expiry, any 3 digits for CVC, any ZIP.

### Full Purchase Flow

1. **Register/Login** as a buyer
2. **Browse tickets** on homepage
3. **Click "View Ticket"** and proceed to purchase
4. **Complete checkout**:
   - Creates order in PENDING status
   - Redirects to `/checkout?orderId=xxx`
   - Enters card details
   - Payment succeeds
5. **Success page** shows confirmation
6. **Webhook processes**:
   - Updates order to PAID
   - Updates tickets to SOLD
   - Creates Payment record
7. **View tickets** at `/account/tickets/bought`
8. **Download QR code** for entry

## Database Schema

Key models:
- `User` - Accounts with verification status
- `Seller` - Seller profiles with Stripe Connect
- `Ticket` - Ticket listings with status (AVAILABLE, RESERVED, SOLD)
- `Order` - Purchase orders with status flow
- `OrderItem` - Individual tickets in an order
- `Payment` - Payment records from Stripe

## Order Status Flow

```
PENDING → PAID → DELIVERED → COMPLETED
   ↓        ↓         ↓
CANCELLED REFUNDED FAILED
```

## Features Implemented

### Authentication & User Management ✅
- Registration with full profile
- Email/Phone verification
- Login/logout
- Password reset
- Profile editing
- Change password

### Marketplace ✅
- Ticket browsing
- Ticket creation (sellers)
- 15-minute reservation system
- Double-sell prevention
- Face value enforcement

### Payments ✅
- Stripe PaymentIntent integration
- Automatic payment capture
- Webhook handling
- Order status updates
- Test mode support

### Ticket Delivery ✅
- QR code generation
- Purchase history
- Order tracking

### Admin ✅
- Manual order capture (backup)
- Order completion
- Forum moderation

## Next Steps for Production

1. **Email Integration**
   - Set up SendGrid/AWS SES
   - Send actual verification emails
   - Send purchase confirmations

2. **SMS Integration**
   - Set up Twilio
   - Send phone verification codes

3. **Seller Onboarding**
   - Complete Stripe Connect onboarding
   - Handle identity verification
   - Enable payouts

4. **Search & Discovery**
   - Full-text search
   - Advanced filters
   - Event management

5. **Notifications**
   - In-app notification center
   - Email notifications
   - Push notifications

6. **Legal**
   - Have Terms and Privacy Policy reviewed by legal counsel

## Support

For issues or questions, contact support@truefantix.com
