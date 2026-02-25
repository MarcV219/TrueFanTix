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

### ✅ Completed Today
1. **Fixed All TypeScript Build Errors**
   - Fixed barcode field mismatches (barcodeType → barcodeText, removed barcodeLast4)
   - Added null checks for gate.user in all API routes
   - Deployment now succeeds consistently

2. **Escrow Timeout System - FULLY OPERATIONAL**
   - ✅ Endpoint `/api/cron/escrow-timeout` deployed and working
   - ✅ `CRON_SECRET` authentication active
   - ✅ Cron jobs running successfully (tested multiple times)
   - ✅ No expired orders found (system healthy)

3. **Notification System - FULLY IMPLEMENTED**
   - ✅ Created `/api/notifications` (GET, PATCH, DELETE)
   - ✅ Notification service library (`src/lib/notifications/service.ts`)
   - ✅ Functions: createNotification, notifyMatchingUsers, notifyNewTicketListed, notifyTicketSold, notifyPurchaseConfirmed, notifyEscrowReleased
   - ✅ Integrated notifications into Stripe webhook (payment success triggers notifications to buyer and seller)

4. **Database Schema - FINALIZED**
   - ✅ All models defined: Ticket, Order, Notification, NotificationPreference, TicketEscrow
   - ✅ Enums: TicketStatus, OrderStatus, TicketVerificationStatus, TicketEscrowState
   - ✅ Fields for AI verification: primaryVendor, transferMethod, barcodeHash, barcodeText, verificationImage

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
