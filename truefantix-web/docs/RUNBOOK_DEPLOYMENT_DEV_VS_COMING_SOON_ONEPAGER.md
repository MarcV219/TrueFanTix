# TrueFanTix Deployment Runbook (One Pager)

**Purpose:** Prevent accidental exposure of the full app on public domains while allowing continuous dev/testing.

## Non‑negotiables (do not break)
1) **Public domains stay on Coming Soon until launch**
- `truefantix.com`, `www.truefantix.com`, `truefantix.ca`, `www.truefantix.ca`
- Must remain attached to the Vercel project: **`true-fan-tix-coming-soon`**

2) **Next.js 16 uses `proxy.ts` (NOT `middleware.ts`)**
- Coming Soon lock enforcement must live in: `truefantix-web/src/proxy.ts`
- Do not add/restore `middleware.ts`.

3) **Vercel Root Directory must be `truefantix-web`**
- Never deploy the repo root.

---

## Source of truth
- Canonical repo: **`MarcV219/TrueFanTix`**
- Next.js app folder: **`truefantix-web/`**

Local dev (MiniPC) canonical working folder:
- `/home/marc/.openclaw/workspace/TrueFanTix/truefantix-web`

---

## Vercel Projects

### A) LIVE Coming Soon project (public)
- **Project:** `true-fan-tix-coming-soon`
- **Branch tracking (Production):** `main`
- **Domains:**
  - `truefantix.com`, `www.truefantix.com`, `truefantix.ca`, `www.truefantix.ca`
- **Required Production env vars:**
  - `COMING_SOON_MODE=1`
  - `DATABASE_URL=<Neon connection string>`

**What users should see (validation):**
- `https://www.truefantix.com/` shows Coming Soon
- Submitting email inserts a new row in Neon table `EarlyAccessLead`
- `https://www.truefantix.com/login` does NOT expose the app (redirect/lock)


### B) DEV app project (no public domains)
- **Project:** `truefantix-web`
- **Branch tracking (Production):** `dev` (important)
- **Domains:**
  - Allowed: `truefantix-web.vercel.app`
  - Forbidden: any `.com` / `.ca` domains
- **Env vars:**
  - Do **NOT** set `COMING_SOON_MODE` here

---

## Git / Branch Workflow (recommended)
- `main`:
  - Only for Live Coming Soon project deployment
- `dev`:
  - The integration branch for development
  - Deploys the `truefantix-web` Vercel dev project
- Feature branches:
  - Create `feat/...` branches
  - Open PRs into `dev`
  - Merge after review/testing

When ready to ship:
- Merge `dev` → `main`
- Re-run Coming Soon validation checklist above

---

## Local development (MiniPC → Windows)
On MiniPC:
- Start dev server (LAN reachable):
  - `npm run dev -- -H 0.0.0.0 -p 3000`

On Windows:
- Open:
  - `http://192.168.2.104:3000/`
  - `http://192.168.2.104:3000/login`

---

## High-signal troubleshooting
- **Vercel build fails:** `DATABASE_URL is not set`
  - Add `DATABASE_URL` to the relevant Vercel project env vars (Production), redeploy

- **DNS resolves but Vercel shows edge 404 NOT_FOUND (with request id)**
  - Domain routing stuck after moves
  - Fastest proven fix: create fresh Vercel project ID, deploy with Root Directory `truefantix-web`, set env vars, attach `www` first

- **Vercel Domains page 404s in dashboard UI**
  - Workaround: Deployments → latest deployment → Add Domain
