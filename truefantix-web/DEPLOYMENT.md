# TrueFanTix Production Deployment Guide

## Pre-Deployment Checklist

### 1. Environment Variables

Ensure all required environment variables are set in your production environment:

```bash
# Database (Use PostgreSQL in production)
DATABASE_URL=postgresql://user:password@host:port/database

# Security (Change all secrets!)
VERIFICATION_SECRET=generate-a-random-64-char-string
SESSION_SECRET=generate-another-random-64-char-string

# Stripe (LIVE keys for production)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# SendGrid (Required for production)
SENDGRID_API_KEY=SG...
FROM_EMAIL=noreply@yourdomain.com

# App
NEXT_PUBLIC_APP_URL=https://www.yourdomain.com
```

**⚠️ CRITICAL: Never commit .env.local to git!**

### 2. Database Migration

For production, migrate from SQLite to PostgreSQL:

```bash
# Update prisma.config.ts for PostgreSQL
# Change from: url: env("DATABASE_URL")
# The DATABASE_URL should be a PostgreSQL connection string

# Run migrations
npx prisma migrate deploy

# (Optional) Seed with initial data
npx prisma db seed
```

### 3. Stripe Live Mode

**⚠️ Switch from Test to Live mode:**

1. Go to Stripe Dashboard → Activate your account
2. Complete business verification
3. Switch to "Live mode" toggle
4. Get new API keys (sk_live_ and pk_live_)
5. Update webhook endpoint to production URL
6. Get new webhook signing secret

**Test a small real payment before full launch!**

### 4. Domain & SSL

- Use a custom domain (not vercel.app subdomain for production)
- Ensure SSL certificate is active
- Update NEXT_PUBLIC_APP_URL

---

## Deployment Options

### Option 1: Vercel (Recommended)

Vercel is the easiest platform for Next.js apps.

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

**Setup:**
1. Connect GitHub repo to Vercel
2. Add environment variables in Vercel dashboard
3. Set framework preset to Next.js
4. Deploy!

**Vercel-specific settings:**
- Build Command: `npm run build` (default)
- Output Directory: `.next` (default)
- Install Command: `npm install` (default)
- Node.js Version: 18.x or 20.x

### Option 2: Railway / Render

Good alternatives with PostgreSQL included.

**Railway:**
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway link
railway up
```

**Render:**
- Connect GitHub repo
- Set environment variables
- Deploy Web Service
- Add PostgreSQL database

### Option 3: Self-Hosted (VPS)

For full control, deploy on your own server.

**Requirements:**
- Node.js 18+ 
- PostgreSQL 14+
- Nginx (reverse proxy)
- PM2 (process manager)

**Steps:**
```bash
# On your server

# 1. Clone repo
git clone https://github.com/yourusername/truefantix-web.git
cd truefantix-web

# 2. Install dependencies
npm install

# 3. Set environment variables
export DATABASE_URL=postgresql://...
export VERIFICATION_SECRET=...
# ... etc

# 4. Build
npm run build

# 5. Run migrations
npx prisma migrate deploy

# 6. Start with PM2
npm install -g pm2
pm2 start npm --name "truefantix" -- start
pm2 save
pm2 startup
```

**Nginx Configuration:**
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Post-Deployment Tasks

### 1. Verify Core Functionality

Test all critical user flows:
- [ ] User registration
- [ ] Email verification (check spam folders)
- [ ] Login/logout
- [ ] Password reset
- [ ] Browse tickets
- [ ] Search tickets
- [ ] Purchase ticket (use small amount)
- [ ] View purchased tickets
- [ ] Download QR code

### 2. Stripe Webhook Verification

Ensure webhooks are delivering:
1. Stripe Dashboard → Developers → Webhooks
2. Check recent deliveries
3. Look for successful 200 responses
4. Check endpoint logs if failures occur

### 3. Monitoring Setup

**Vercel Analytics:**
- Built-in analytics for performance
- Real Experience Score

**Error Tracking (Recommended):**
Set up Sentry or similar:
```bash
npm install @sentry/nextjs
```

**Logging:**
- Check Vercel Function Logs
- Set up Logtail or similar for production

### 4. Backups

**Database:**
```bash
# Daily PostgreSQL backup
cron: 0 2 * * * pg_dump $DATABASE_URL > backup-$(date +\%Y\%m\%d).sql
```

**Or use managed database:**
- Railway, Render, Supabase all have automatic backups

### 5. Security Checklist

- [ ] All secrets rotated (not using dev secrets)
- [ ] HTTPS enforced
- [ ] Security headers set (Vercel does this automatically)
- [ ] Rate limiting enabled (already in code)
- [ ] CORS configured properly
- [ ] No sensitive data in logs

---

## Scaling Considerations

### Database

- Start with smallest PostgreSQL instance
- Monitor connection limits
- Add connection pooling (PgBouncer) if needed

### Images

Current setup stores images as URLs/paths. For production:
- Use Cloudinary, AWS S3, or similar
- Implement image optimization

### Caching

Consider adding:
- Redis for session storage
- CDN for static assets (Vercel Edge Network does this)

---

## Troubleshooting

### Build Failures

```bash
# Clear cache
rm -rf .next node_modules
npm install
npm run build
```

### Database Connection Issues

- Check DATABASE_URL format
- Verify firewall rules
- Check connection limits

### Stripe Webhook Failures

- Verify webhook URL is correct
- Check STRIPE_WEBHOOK_SECRET matches
- Look at webhook delivery attempts in Stripe dashboard

### Email Not Sending

- Verify SENDGRID_API_KEY
- Check sender identity is verified in SendGrid
- Look at email activity in SendGrid dashboard

---

## Maintenance

### Regular Tasks

- **Weekly:** Check error logs
- **Monthly:** Review Stripe payouts
- **Quarterly:** Security audit, dependency updates

### Updates

```bash
# Update dependencies
npm update

# Security audit
npm audit
npm audit fix

# Test thoroughly before deploying updates
```

---

## Support & Monitoring

**Key Metrics to Watch:**
- Checkout completion rate
- Payment success rate
- Page load times
- Error rates
- User registration rate

**Alerts:**
- Payment failures > 5%
- Error rate > 1%
- Response time > 3s

---

## Cost Estimates (Monthly)

| Service | Estimated Cost |
|---------|---------------|
| Vercel Pro | $20 |
| PostgreSQL (Railway/Render) | $5-15 |
| SendGrid | Free tier (100 emails/day) |
| Stripe | Per-transaction fees (2.9% + 30¢) |
| Domain | $10-15/year |
| **Total** | **~$30-50/month** |

---

## Legal & Compliance

Before going live:
- [ ] Terms of Service reviewed by legal counsel
- [ ] Privacy Policy reviewed by legal counsel
- [ ] GDPR compliance (if serving EU users)
- [ ] PCI compliance (Stripe handles most of this)
- [ ] Business registration
- [ ] Tax setup for marketplace sales

---

## Launch Day Checklist

- [ ] All environment variables set
- [ ] Database migrated and seeded
- [ ] Stripe in Live mode
- [ ] SendGrid sender verified
- [ ] Domain pointing correctly
- [ ] SSL active
- [ ] Test purchase completed successfully
- [ ] Team has access to admin tools
- [ ] Monitoring enabled
- [ ] Rollback plan ready

**🚀 You're ready to launch!**
