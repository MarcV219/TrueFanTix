# Show HN: I built a ticket marketplace that bans scalpers

**TL;DR**: After getting priced out of concerts one too many times, I built TrueFanTix—a ticket marketplace where tickets can only be sold at or below face value. No scalpers allowed.

---

## The Problem

I'm a music fan. Have been since I was a teenager. Some of my best memories are from live events.

But over the past decade, something changed. I'd wake up early, get in the online queue the second tickets went on sale, and still get nothing. Then I'd see those same tickets on StubHub and Ticketmaster's resale site minutes later—for 2x, 3x, 4x the price.

The game is rigged. Bots buy up inventory. Professional scalpers treat tickets like commodities. And actual fans—the people these events are FOR—get priced out.

I got tired of complaining about it. So I built something.

---

## What I Built

**TrueFanTix** (https://truefantix.com) is a ticket marketplace with one hard rule:

> **Tickets must be listed at or below face value. Period.**

No exceptions. No workarounds. If you want to sell on TrueFanTix, you can't profit off other fans.

### How It Works

**For Sellers:**
- List tickets at or below what you paid
- Transfer to our escrow system (prevents duplicate sales)
- Get paid 100% of your listing price when delivered
- Sold a sold-out event ticket? Earn access tokens to buy other sold-out events

**For Buyers:**
- Browse verified listings (all at/below face value)
- Buy with confidence—tickets are held in escrow until transfer
- Never pay scalper prices again
- Sold-out events require access tokens (earned by selling to sold-out events)

**The Access Token System:**
- Sell a ticket to a sold-out event → Earn 1 access token
- 1 access token = Ability to buy 1 sold-out event ticket
- Tokens never expire
- Creates a closed loop: help other fans → get access to hard-to-get tickets

---

## The Tech Stack

- Next.js 16 + React 19
- Prisma + SQLite (migrating to PostgreSQL)
- Stripe for payments
- Twilio for SMS verification
- SendGrid for email
- Hosted on a MiniPC in my basement (yes, really)

---

## Why This Is Different

Most "fan-friendly" initiatives are PR stunts. This is structural:

1. **Price Ceiling**: Hard enforcement at the platform level
2. **Mandatory Escrow**: Sellers must prove they have tickets before listing
3. **No Seller Fees**: Buyers pay 8.75% admin fee (covers payment processing), sellers keep 100%
4. **Reputation System**: Sellers build trust through successful transactions

---

## The Business Model

Honestly? Still figuring it out.

Right now I take an 8.75% admin fee on buyer transactions. That covers Stripe fees (~3%) and server costs. The rest goes into reserves for dispute resolution and platform improvements.

Long-term, I see potential in:
- B2B partnerships with venues/artists (official resale partner)
- Premium features for high-volume sellers
- Geographic expansion

But the core mission stays: fans over profits.

---

## What's Next

Looking for:
- **Beta users**: Try the platform, break things, tell me what sucks
- **Partnerships**: Music venues, sports teams, fan clubs—anyone who cares about fans
- **Feedback**: Brutal honesty appreciated

---

## About Me

I'm Marc, based in Toronto. By day I run IgniteX Innovations (a holding company for projects like this). By night I'm at concerts, Raptors games, and whatever else I can get tickets to—hopefully at fair prices now.

This isn't my first startup, but it's the first one that hits personally. I'm tired of the scalping industry. Let's see if we can build something better.

---

**Questions? I'll be here all day.**

**Try it out**: https://truefantix.com

**GitHub**: [If you want to open source components later]

---

*EDIT*: Wow, this blew up. Answering common questions below:

**Q: How do you prevent people from lying about face value?**
A: We're building verification systems—receipt upload for now, API integrations with primary sellers eventually. Plus the reputation system penalizes bad actors.

**Q: What about fees? The price + 8.75% could be above face value.**
A: The 8.75% is a platform fee, not seller profit. And yes, buyers pay slightly more than face—but significantly less than scalper sites (which add 20-40% on top of inflated prices).

**Q: How do you make money?**
A: Right now? I don't, really. I'm funding this myself. Long-term, volume matters more than margin. If we can process enough transactions at 8.75%, that covers costs and pays for growth.

**Q: Can I work with you?**
A: Always looking for help. Particularly need: React/Next.js devs, community managers, and connections in the music/sports industry. marc@ignitex.com

---

**Thanks HN**. The response has been overwhelming. Building in public from here on out.
