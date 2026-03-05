# TrueFanTix

A fan-first ticket marketplace focused on fairness, transparency, and resale at or below face value.

## 🎯 Mission

TrueFanTix exists to give fans a fair shot at tickets. No scalpers. No price gouging. Just fans helping fans.

## ✨ Features

### For Buyers
- ✅ Browse and search tickets at or below face value
- ✅ Secure checkout with Stripe
- ✅ QR code tickets for easy entry
- ✅ Purchase history and order tracking
- ✅ Verified sellers only

### For Sellers
- ✅ Easy ticket listing
- ✅ Stripe Connect for payouts
- ✅ Seller verification system
- ✅ Track sales and earnings

### Platform
- ✅ User registration with email/phone verification
- ✅ Password reset
- ✅ Profile management
- ✅ Forum for community discussions
- ✅ Admin tools for moderation

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL (or SQLite for dev)
- Stripe account
- SendGrid account (for production email)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/truefantix-web.git
cd truefantix-web

# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your API keys

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev
```

Visit `http://localhost:3000`

### Environment Variables

See [SETUP.md](./SETUP.md) for detailed configuration instructions.

Key variables:
- `DATABASE_URL` - Database connection string
- `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` - Stripe API keys
- `SENDGRID_API_KEY` - Email service
- `VERIFICATION_SECRET` - For secure tokens

## 📖 Documentation

- [SETUP.md](./SETUP.md) - Development setup and configuration
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Production deployment guide

## 🏗️ Architecture

### Tech Stack
- **Framework:** Next.js 16 (App Router)
- **Database:** Prisma ORM with PostgreSQL/SQLite
- **Authentication:** Session-based with bcrypt
- **Payments:** Stripe (PaymentIntents + Connect)
- **Email:** SendGrid
- **Styling:** Tailwind CSS + inline styles

### Database Schema

Key entities:
- `User` - Accounts with verification status
- `Seller` - Seller profiles with Stripe Connect
- `Ticket` - Ticket listings
- `Order` - Purchase orders
- `OrderItem` - Individual tickets in orders
- `Payment` - Payment records
- `ForumThread` / `ForumPost` - Community forum

See `prisma/schema.prisma` for full schema.

### Order Flow

```
PENDING (order created, payment pending)
    ↓
PAID (Stripe webhook confirms payment)
    ↓
DELIVERED (tickets transferred)
    ↓
COMPLETED (event passed, seller paid)
```

## 🧪 Testing

### Manual Testing

**Test Cards (Stripe):**
- `4242 4242 4242 4242` - Successful payment
- `4000 0000 0000 0002` - Declined card

**Test Flow:**
1. Register account
2. Verify email/phone
3. Complete seller onboarding (Stripe Connect)
4. List a ticket
5. Buy a ticket (as different user)
6. Download QR code

### Automated Testing

```bash
# Run tests (when available)
npm test
```

## 📁 Project Structure

```
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── api/            # API routes
│   │   ├── account/        # User account pages
│   │   ├── checkout/       # Payment flow
│   │   ├── forum/          # Community forum
│   │   ├── login/          # Auth pages
│   │   ├── register/
│   │   ├── search/         # Ticket search
│   │   └── ...
│   ├── components/          # Shared components
│   └── lib/                 # Utilities
│       ├── auth/           # Authentication
│       ├── email.ts        # Email service
│       └── prisma.ts       # Database client
├── prisma/
│   └── schema.prisma       # Database schema
├── public/                  # Static assets
├── SETUP.md                # Setup guide
└── DEPLOYMENT.md           # Deployment guide
```

## 🔒 Security

- Passwords hashed with bcrypt (12 rounds)
- Sessions with HTTP-only cookies
- CSRF protection
- Rate limiting on sensitive endpoints
- Input validation on all APIs
- SQL injection protection (Prisma)
- XSS protection (React escapes by default)

## 🤝 Contributing

This is a private project. For issues or suggestions, contact the development team.

## 📜 License

Private - All rights reserved.

## 🙏 Acknowledgments

- Stripe for payment processing
- SendGrid for email delivery
- Vercel for hosting platform
- Open source community

---

**Built with ❤️ for fans, by fans.**

<!-- redeploy trigger: 2026-03-05T18:10:32Z -->
