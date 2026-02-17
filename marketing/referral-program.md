# TrueFanTix Referral Program Design

## Program Overview

**Program Name**: "Share the Fan Love"

**Core Concept**: Reward users who invite friends to the platform, creating organic growth through the fan community.

**Tagline**: "Help a fan, get rewarded"

---

## Program Structure

### Tier 1: Standard Referral (Give $5, Get $5)

**Mechanics:**
- Referrer gets unique referral code/link
- Referee uses code during signup
- When referee makes first purchase, both get $5 account credit
- Credits apply to future ticket purchases

**Rules:**
- Minimum referee purchase: $25 (prevents gaming)
- Credits expire after 12 months
- Cannot be combined with other promotions
- No limit on number of referrals per user

**User Journey:**
1. User sees "Share the Fan Love" banner in account
2. Clicks to get unique referral link/code
3. Shares via email, text, social media
4. Friend clicks link, signs up
5. Friend makes first purchase
6. Both accounts credited $5 within 24 hours
7. Email notification sent to both parties

---

### Tier 2: Super Fan Status (Volume Rewards)

**Mechanics:**
- Track total successful referrals per user
- Unlock status tiers at milestones

**Milestones:**

| Referrals | Status | Reward |
|-----------|--------|--------|
| 5 | True Fan | $25 bonus + badge on profile |
| 10 | Super Fan | $50 bonus + early access to sold-out tickets |
| 25 | Legend | $150 bonus + "Founding Fan" status + free premium support |
| 50 | Hall of Fame | $400 bonus + lifetime waived buyer fees |

**Benefits:**
- **Badges**: Display on profile, forum posts, listings
- **Early Access**: 24-hour head start on sold-out event listings
- **Premium Support**: Direct email/phone support line
- **Lifetime Perks**: Permanent fee waivers, exclusive features

---

### Tier 3: Influencer/Community Program (Custom)

**For**: Bloggers, podcasters, fan club leaders, event organizers

**Mechanics:**
- Custom referral codes (e.g., "RAPTORSFAN2026")
- Higher payout: $10 per successful referral
- Performance bonuses:
  - 10 referrals in a month: Extra $100
  - 25 referrals in a month: Extra $300
  - 50 referrals in a month: Extra $750

**Requirements:**
- Must disclose affiliation (FTC compliance)
- Content must align with TrueFanTix values
- No spam, bots, or paid traffic arbitrage

**Support Provided:**
- Branded graphics and copy
- Exclusive updates and news
- Direct line to marketing team
- Potential co-marketing opportunities

---

## Technical Implementation

### Database Schema

```sql
-- Referral codes table
CREATE TABLE ReferralCodes (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES User(id)
);

-- Referrals tracking
CREATE TABLE Referrals (
  id TEXT PRIMARY KEY,
  referrerCodeId TEXT NOT NULL,
  refereeUserId TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'PENDING', -- PENDING, COMPLETED, EXPIRED
  referrerRewardCents INTEGER DEFAULT 500, -- $5.00
  refereeRewardCents INTEGER DEFAULT 500,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  completedAt DATETIME,
  FOREIGN KEY (referrerCodeId) REFERENCES ReferralCodes(id),
  FOREIGN KEY (refereeUserId) REFERENCES User(id)
);

-- User rewards/credits
CREATE TABLE UserCredits (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  amountCents INTEGER NOT NULL,
  source TEXT NOT NULL, -- REFERRAL, PROMOTION, REFUND
  referralId TEXT,
  expiresAt DATETIME,
  usedAt DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES User(id),
  FOREIGN KEY (referralId) REFERENCES Referrals(id)
);
```

### API Endpoints

```typescript
// Generate referral code
POST /api/referrals/generate-code
Response: { code: string, link: string }

// Get user's referral stats
GET /api/referrals/stats
Response: {
  code: string,
  totalReferrals: number,
  pendingReferrals: number,
  completedReferrals: number,
  totalEarnedCents: number,
  currentTier: string,
  nextTierProgress: number
}

// Apply referral code (during signup)
POST /api/referrals/apply
Body: { code: string, userId: string }

// Get referral leaderboard (public)
GET /api/referrals/leaderboard
Response: { users: [{ name, avatar, referralCount, tier }] }
```

### Referral Code Generation

**Format Options:**
1. Random alphanumeric: `A7B9X2K4`
2. User-based: `MARC2026`, `FAN_TORONTO`
3. Word-based: `HELP-FANS-42`

**Recommendation**: Start with random 8-char codes, allow custom codes for Super Fans+

---

## User Interface

### Referral Section in Account

**Location**: `/account/referrals`

**Components:**
1. **Hero Section**
   - "Share the Fan Love"
   - Give $5, Get $5
   - Big call-to-action button

2. **Your Referral Code**
   - Prominent display of code
   - Copy button
   - Social sharing buttons (Twitter, Facebook, Email, Copy Link)

3. **Stats Dashboard**
   - Total referrals
   - Successful conversions
   - Total earned
   - Current tier status
   - Progress to next tier

4. **Referral History Table**
   - Date | Referred User | Status | Reward
   - Status: Pending → Completed

5. **How It Works**
   - 3-step visual guide
   - FAQ accordion

### On-Site Prompts

**Post-Purchase**: "Love your tickets? Share the Fan Love and earn $5!"
**Account Dashboard**: Banner showing referral opportunity
**Email Receipt**: Include referral code in purchase confirmation
**Forum/Community**: Badge showing referral status

---

## Marketing Copy

### Referral Page Headline
> **Share the Fan Love**
> 
> Help your friends discover fair ticket prices and earn rewards!

### How It Works Section
1. **Get Your Code** - Click below to generate your unique referral link
2. **Share with Friends** - Send via text, email, or social media
3. **Earn Rewards** - When they buy their first ticket, you both get $5 credit

### Email Template (Referrer)

**Subject**: 🎉 You earned $5 in TrueFanTix credit!

> Hi [Name],
> 
> Great news! Your friend [Friend Name] just bought their first ticket on TrueFanTix using your referral code.
> 
> **You've earned $5 in account credit!**
> 
> Your credit will automatically apply to your next ticket purchase.
> 
> Keep sharing—the more fans you help, the more you earn:
> - 5 referrals = True Fan status + $25 bonus
> - 10 referrals = Super Fan status + early access to sold-out tickets
> - 25 referrals = Legend status + $150 bonus
> 
> Your referral code: **[CODE]**
> 
> Share again: [Twitter] [Facebook] [Email]
> 
> Thanks for being part of the fan community!
> 
> — The TrueFanTix Team

### Email Template (Referee)

**Subject**: Welcome to TrueFanTix! Here's your $5 credit

> Hi [Name],
> 
> Welcome to TrueFanTix—the ticket marketplace that puts fans first!
> 
> Your friend [Referrer Name] sent you here, and we think that's pretty great.
> 
> **Here's $5 toward your first ticket purchase!**
> 
> The credit has been automatically added to your account and will apply at checkout.
> 
> Start browsing: [Browse Tickets Button]
> 
> What makes us different?
> - All tickets at or below face value
> - No scalpers allowed
> - Secure escrow system
> - Fans helping fans
> 
> Questions? Reply to this email anytime.
> 
> Happy ticket hunting!
> 
> — The TrueFanTix Team

---

## Promotion Strategy

### Launch Campaign

**Week 1-2: Soft Launch**
- Enable for existing users only
- Test tracking and payouts
- Gather feedback

**Week 3-4: Public Launch**
- Email to all users
- Social media announcement
- Blog post: "Introducing Share the Fan Love"
- Reddit announcement on r/truefantix (if exists)

**Month 2: Push for Growth**
- Double rewards for 48 hours (Give $10, Get $10)
- Leaderboard competition (top referrer wins sold-out event tickets)
- Influencer outreach

### Ongoing Promotion

**Monthly:**
- Referrer spotlight (feature top referrer in email/blog)
- Tier progression celebration emails
- "Referral Report" (your monthly stats)

**Quarterly:**
- Special 2x reward weekends
- Exclusive merchandise for Super Fans+
- Virtual meetup for top 100 referrers

---

## Fraud Prevention

### Red Flags:
- Multiple accounts with same IP/email
- Referrals with no purchase history
- Sudden spike in referrals from one user
- Referrals using disposable emails

### Prevention Measures:
- Email verification required for referees
- Minimum purchase amount ($25) before reward
- 7-day holding period before credit release
- Manual review for users with >10 referrals in a week
- Device fingerprinting to detect duplicate accounts

### Enforcement:
- First offense: Warning
- Second offense: Referral program suspension
- Third offense: Account termination

---

## Budget Projection

### Month 1-3 (Beta)
- Expected referrals: 50-100
- Cost: $250-500 in credits
- Admin time: 5 hours/week

### Month 4-6 (Growth)
- Expected referrals: 300-500
- Cost: $1,500-2,500 in credits
- Admin time: 10 hours/week

### Month 7-12 (Scale)
- Expected referrals: 1,000-2,000
- Cost: $5,000-10,000 in credits
- Consider hiring community manager

**ROI Calculation:**
- Average ticket price: $100
- Platform fee (8.75%): $8.75
- Referral cost: $5
- Net per referred purchase: $3.75

As long as referred users buy at least one ticket, the program is profitable.

---

## Success Metrics

### Primary KPIs:
1. Referral conversion rate (referrals / active users)
2. Cost per acquisition via referral
3. Referred user LTV vs. organic
4. Viral coefficient (referrals per user)

### Target Goals:
- Month 1: 5% of users refer at least one person
- Month 3: 15% referral rate
- Month 6: 25% of new users come from referrals
- Month 12: Referrals are #1 acquisition channel

### Tracking Dashboard:
- Daily: New referrals, completions
- Weekly: Conversion rates, top referrers
- Monthly: LTV analysis, fraud incidents

---

## Future Enhancements

### Phase 2 (Month 6+):
- Gamification: Badges, achievements, levels
- Team challenges: "Help 100 Toronto fans get to Raptors games"
- Charity option: "Donate my referral credits to [Music Education Charity]"
- Corporate program: Companies get group rates for referring employees

### Phase 3 (Year 2):
- Affiliate API for partner integrations
- Crypto reward option (stablecoins)
- International expansion considerations
- Partnership with fan clubs for exclusive referral perks

---

**Referral Program v1.0 - February 2026**
