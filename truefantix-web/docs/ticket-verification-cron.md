# Ticket Verification Cron

This project supports automatic pending-ticket verification via:

- `POST /api/tickets/verify/pending`
- Auth options:
  - Admin session cookie, or
  - Internal cron header: `x-ticket-verify-key: <TICKET_VERIFY_CRON_KEY>`

## Environment

Set in your runtime environment:

- `TICKET_VERIFY_CRON_KEY` (required for cron-key auth)
- `TFT_BASE_URL` (optional, default `http://localhost:3000`)
- `TFT_VERIFY_TAKE` (optional, default `50`)

## Helper script

Use:

```bash
./scripts/verify-pending-tickets.sh
```

## Example crontab (every 5 minutes)

```cron
*/5 * * * * cd /path/to/truefantix-web && TICKET_VERIFY_CRON_KEY='your-secret' TFT_BASE_URL='https://your-domain.com' ./scripts/verify-pending-tickets.sh >> /var/log/truefantix-verify.log 2>&1
```
