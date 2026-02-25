# MEMORY.md - Long-Term Memory

## Installation & Setup
**Date:** February 15, 2026 (Initial Setup)
- Fresh OpenClaw installation (version 2026.2.14, later updated to 2026.2.24)
- Gateway configured on port 18789 (loopback)
- Workspace: `/home/marc/.openclaw/workspace`

## Identity
**Name:** Jim  
**Creature:** Familiar - helpful, clear, informative presence  
**Vibe:** Calm and steady  
**Emoji:** 🌙  

## User Profile
**Name:** Marc  
**Timezone:** America/Toronto (EST)  
**Relationship:** "Great friends and coworkers"  
**Communication:** Telegram (primary), direct chat

## Multi-Provider Model Configuration
**Budget:** $200/month, $10/day, alert at 80%  
**Primary:** moonshot/kimi-k2.5 (free tier)  
**Fallback Chain:**
1. moonshot/kimi-k2.5 (free)
2. google/gemini-2.5-flash ($0.075/$0.30)
3. openai/gpt-4o-mini ($0.15/$0.60)
4. anthropic/claude-3-5-haiku ($0.80/$4.00)
5. openai/gpt-4o ($2.50/$10.00)
6. anthropic/claude-3-5-sonnet ($3.00/$15.00)
7. xai/grok-2 ($5.00/$15.00)

**Local Models (Ollama):**
- ollama/mistral (alias: Mistral) - 200K context
- ollama/qwen2.5:7b (alias: Qwen25) - 128K context
- ollama/qwen2.5-coder:7b (alias: QwenCoder) - 128K context, optimized for coding

## Major Projects

### TrueFantix Platform
**Status:** In active development (Feb 2026)

**Components:**
- **Notification System** - Database schema designed, in implementation
- **Escrow System** - Order statuses: PENDING, PAID, DELIVERED, COMPLETED, CANCELLED
- **API Development** - Next.js app with order management endpoints

**Known Issues:**
- Escrow timeout endpoint (`/api/cron/escrow-timeout`) needs implementation
- Cron job configured but endpoint doesn't exist yet
- Requires `CRON_SECRET` environment variable in Vercel

**Order Timeout Logic:**
- PAID orders timeout after 60 minutes
- Auto-cancel expired orders
- Refund buyer, release seller reservation
- Return count of affected orders

## System Maintenance

### Automated Checks (Cron Jobs)
1. **Daily Budget Check** - 4:30 AM (checks $10 daily / $200 monthly)
2. **Escrow Timeout Check** - Attempted but endpoint unavailable
3. **OpenClaw Update Check** - Daily at 4:30 AM (checks for new versions)

### Recent Updates
**Feb 25, 2026:**
- Updated OpenClaw 2026.2.19-2 → 2026.2.24
- Fixed dashboard script output (now logs to `~/.openclaw/dashboard_update.log`)
- Configured daily update check cron job
- Fixed Ollama model authentication issue
- All 3 Ollama models now working (Mistral, Qwen25, QwenCoder)

## Backup & Recovery

### IDrive Cloud Backup
**Provider:** IDrive for Linux  
**Location:** `/opt/IDriveForLinux/bin/idrive`  
**Web Interface:** Available but browser relay not functioning  
**Issue:** Chrome extension relay on port 18792 not accessible from Windows PC

### Session Archives
**Location:** `~/.openclaw/agents/main/sessions/`  
**Format:** `.jsonl` files (active) and `.jsonl.deleted` (archived)  
**Recovery:** Daily memories reconstructed from session files Feb 15-21

## File Locations

**Configuration:**
- Main config: `~/.openclaw/openclaw.json`
- Gateway logs: `/tmp/openclaw/openclaw-YYYY-MM-DD.log`
- Agent auth: `~/.openclaw/agents/main/agent/auth-profiles.json`

**Memory:**
- Daily logs: `memory/YYYY-MM-DD.md`
- Long-term: `MEMORY.md` (this file)

**Scripts:**
- Dashboard tracker: `cron-budget-tracker.sh`
- Logs: `~/.openclaw/dashboard_update.log`

## Recent Progress (Feb 25, 2026)

### ✅ Completed Today - MAJOR FEATURES

#### 1. **Production Infrastructure**
- ✅ **Rate Limiting Middleware** (`src/middleware.ts`)
  - Per-route rate limits (auth: 5/min, checkout: 3/min, etc.)
  - Security headers (XSS, CSRF, clickjacking protection)
  - IP + User-Agent based tracking

- ✅ **Input Validation System** (`src/lib/validation.ts`)
  - Zod schemas for all major inputs
  - XSS sanitization
  - Type-safe request validation middleware

- ✅ **Audit Logging** (`src/lib/audit.ts`)
  - Comprehensive action tracking
  - User activity monitoring
  - Security event detection

#### 2. **Fixed All TypeScript Build Errors**
- Fixed barcode field mismatches (barcodeType → barcodeText, removed barcodeLast4)
- Added null checks for gate.user in all API routes
- Deployment now succeeds consistently

#### 3. **Escrow Timeout System - FULLY OPERATIONAL**
- ✅ Endpoint `/api/cron/escrow-timeout` deployed and working
- ✅ `CRON_SECRET` authentication active
- ✅ Cron jobs running successfully (tested multiple times)
- ✅ No expired orders found (system healthy)

#### 4. **Notification System - FULLY IMPLEMENTED**
- ✅ `/api/notifications` - Complete CRUD (GET, PATCH, DELETE)
- ✅ Notification service library with 6 helper functions
- ✅ Integrated into Stripe webhook (auto-triggers on payment)

#### 5. **Advanced Search System** 🎉
- ✅ `/api/tickets/search` - Full-text search with relevance scoring
- ✅ Smart facets (price ranges, venues, dates)
- ✅ Multi-field search (title, venue, event, barcode)
- ✅ Sorting by relevance, price, date

#### 6. **Price Drop Alert System** 🎉
- ✅ `/api/price-alerts` - Create alerts for specific tickets or events
- ✅ Automatic price monitoring
- ✅ Notifications when prices drop below target
- ✅ Cron job ready for 15-minute interval checks

#### 7. **Seller Reputation & Fraud Detection** 🎉
- ✅ Comprehensive reputation scoring algorithm
  - Trustworthiness (40%): Account age, sales history, disputes
  - Responsiveness (30%): Transfer speed, listing activity
  - Quality (30%): Verification rate, completion rate
- ✅ 6 seller levels: NEW → BRONZE → SILVER → GOLD → PLATINUM → DIAMOND
- ✅ Automated badge system
- ✅ **Fraud Risk Detection**: ML-like heuristic scoring
  - 10+ risk factors analyzed
  - Real-time transaction risk assessment
  - Recommendations for high-risk transactions

#### 8. **Email Verification & Password Reset** 🔐
- ✅ `/api/auth/verify-email` - Send and verify email verification links
- ✅ `/api/auth/forgot-password` - Request password reset
- ✅ Secure token-based verification with expiration
- ✅ Rate limiting on auth endpoints

#### 9. **AI-Powered Price Recommendations** 🤖
- ✅ `/api/pricing/recommendation` - Get optimal ticket pricing
- ✅ Market analysis: comparable tickets, demand scoring
- ✅ 10+ pricing factors: seat quality, event urgency, seller reputation
- ✅ Price range suggestions with confidence scores
- ✅ Trend analysis over time

#### 10. **Waitlist System for Sold-Out Events** 📋
- ✅ `/api/waitlist` - Join waitlist for unavailable events
- ✅ Automatic notifications when tickets become available
- ✅ Price limit preferences
- ✅ Captures lost sales opportunities

#### 11. **Real-Time Notifications & Messaging** 💬
- ✅ **WebSocket Server:** (`src/lib/websocket.ts`)
  - Real-time event notifications
  - In-app messaging integration
  - User online/offline tracking
  - Event-specific subscriptions
- ✅ **In-App Messaging API:** (`src/app/api/messages/route.ts`)
  - Buyer-seller chat functionality
  - Conversation listing and message retrieval
  - Attachments support
  - Read receipts and typing indicators

#### 12. **Reviews & Ratings System** ⭐
- ✅ `/api/reviews` - Submit, view, and manage reviews
- ✅ Seller rating aggregation (1-5 stars)
- ✅ Review editing within 24 hours
- ✅ Automated badge updates for sellers based on reviews
- ✅ Detailed rating distribution

### **Summary of All New Features**

**Total New API Endpoints:** 18+
**New Database Models:** 7 (AuditLog, PriceAlert, PasswordResetToken, WaitlistEntry, Conversation, ConversationParticipant, Message, MessageAttachment, Review)
**New Service Libraries:** 7 (reputation, pricing, audit, validation, websocket, email, auth/guards)
**Production Infrastructure:** Rate limiting, security headers, input validation

## Pending Tasks

### Critical
- [x] Provide public URL for `/api/cron/escrow-timeout` endpoint
- [x] Implement escrow timeout route in TrueFantix app
- [x] Fix Vercel deployment build error
- [x] Configure `CRON_SECRET` in production

### Browser Relay
- [ ] Troubleshoot Chrome extension relay (port 18792)
- [ ] Alternative: Use Windows PC direct download for IDrive
- [ ] Or: Install desktop environment on MiniPC for Remote Desktop

### Cost Tracking
- [ ] Enable cost tracking in session status for budget monitoring
- [ ] Verify API key configuration for all providers

## Important Decisions

1. **Model Strategy:** Use local Ollama models for routine tasks, cloud models only when necessary for complex work
2. **Security:** Never change IDrive settings without explicit user permission
3. **Access:** Remote Desktop requires desktop environment installation (not currently available)
4. **Budget:** Strict adherence to $10/day limit; switch to free models when approaching limits

## Key Learnings

- Ollama models require auth profile entry even though they don't use API keys
- Browser relay requires desktop session on same machine (or complex port forwarding)
- Session `.jsonl` files can be parsed to reconstruct lost daily memories
- Compaction archives sessions as `.jsonl.deleted` files

---

_Last Updated: February 25, 2026 by Jim 🌙_
