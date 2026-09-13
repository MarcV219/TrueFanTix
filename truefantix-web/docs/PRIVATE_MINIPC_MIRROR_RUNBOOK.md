# Private MiniPC Mirror Runbook

## Current boundary

- The mirror is private and listens only on `127.0.0.1:3100`.
- PostgreSQL 17 listens only on `127.0.0.1:55432` and is not exposed through the router or Cloudflare.
- The public domains, Vercel deployment, DNS, payments, and webhooks remain unchanged.
- Public cutover requires explicit approval after the checklist below passes.

## Services

- `truefantix-private-mirror.service`: local Next.js application mirror.
- `truefantix-private-mirror-db`: Docker PostgreSQL database with a persistent named volume.
- `truefantix-private-mirror-backup.timer`: nightly encrypted logical backup at 11:15 PM America/Toronto.
- Encrypted backups live in `/home/marc/.openclaw/backups/truefantix-private-mirror` with 14-day retention.

## Verification

```bash
systemctl --user status truefantix-private-mirror.service
systemctl --user status truefantix-private-mirror-backup.timer
curl http://127.0.0.1:3100/api/health
docker exec truefantix-private-mirror-db pg_isready -U truefantix_mirror -d truefantix_mirror
```

## Cutover gate

1. Import the newest verified production dump and reconcile changes made after it.
2. Install or rotate the Gmail OAuth values locally; Vercel sensitive values cannot be exported.
3. Replace the mirror database's loopback-only trust authentication with a generated SCRAM credential.
4. Build an immutable app checkout and run full authenticated, payment-provider sandbox, webhook, and outreach checks.
5. Configure Cloudflare Tunnel for the local HTTP app only; keep PostgreSQL private.
6. Confirm UPS/power recovery, router recovery, monitoring, backup retention, and off-site backup completion.
7. Lower DNS TTL, announce a maintenance window, pause writes, run the final delta migration, and verify row counts.
8. Switch traffic only after explicit approval. Keep Vercel and Neon unchanged for immediate rollback.

## Rollback

Return the Cloudflare origin/DNS route to Vercel, verify the Vercel health endpoints, and reconcile writes made during the MiniPC window before reopening transactions. Never restore over either source database during rollback.
