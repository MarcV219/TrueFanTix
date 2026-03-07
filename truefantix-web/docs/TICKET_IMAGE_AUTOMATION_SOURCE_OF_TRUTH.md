# TrueFanTix Ticket Image Automation + Audit Notes (Source of Truth)

_Last updated: 2026-03-07_

## Objective
Ensure ticket images are fetched **automatically** and **relevantly**, with clear auditability and controlled repair of stale stored images (no manual per-ticket mapping).

---

## 1) Automated image pipeline (source of truth)

### Core module
- `src/lib/imageSearch.ts`
- Responsibility: automated image retrieval + filtering + fallback logic.

### Pipeline steps
1. Build image search query from `title + eventType` (`getImageSearchQuery`).
2. Query Brave Images API via `BRAVE_API_KEY`.
3. Filter blocked domains (hotlink-restricted/unstable/stock-photo).
4. Score relevance (token overlap against metadata/url).
5. Rank candidates (reliability + overlap + HTTPS).
6. Use strict overlap results first; if none, use relaxed best-safe fallback.
7. Cache by `ticketTitle + eventType` key.
8. Fallback to event placeholder when no acceptable candidate exists.

### Hardening updates
- `c0465eb`: better query normalization for festival/conference/workshop (e.g., Lollapalooza, SXSW, CES, TIFF) and suffix stripping.
- `1064c2a`: blocked `static.wikia.nocookie.net` due to unstable hotlink behavior causing blank renders.

---

## 2) Where the pipeline is used
- `GET /api/tickets/image` (`src/app/api/tickets/image/route.ts`)
- Ticket details dynamic image flow
- Seed/reseed route (`src/app/api/debug/seed/route.ts`)
- Ticket creation API (`POST /api/tickets`) server-side image selection

---

## 3) Ticket creation enforces server-side automation
- File: `src/app/api/tickets/route.ts`
- Enforcement commit: `99c20dd`
- Audit fields commit: `316f452`

### Create-time behavior
1. Infer event type from title.
2. Call `getTicketImage(title, inferredEventType)` server-side.
3. If non-placeholder result exists, store it.
4. If placeholder and client image exists, use client image fallback.
5. If still empty, use `/default.jpg`.

---

## 4) Audit fields (create-time + fetch-time)

### POST `/api/tickets` response
- `imageSource`: `brave | client-fallback | placeholder`
- `imageReason`:
  - `auto-image-selected`
  - `auto-returned-placeholder-used-client-image`
  - `empty-image-fallback-default`

### GET `/api/tickets/image` response
- `imageUrl`
- `isPlaceholder`
- `imageSource`: `brave | placeholder`
- `imageReason`:
  - `auto-image-selected`
  - `no-usable-auto-image-placeholder`

Commit: `3529740` (adds `imageSource` + `imageReason` to `/api/tickets/image`).

---

## 5) Debug diagnostics endpoint

### Base route
- `GET /api/debug/tickets/images?take=25`

### File
- `src/app/api/debug/tickets/images/route.ts`

### Commit
- `85b4f8e`

### Per-row diagnostics
- `id, title, status, eventType, venue, date`
- `storedImage`, `storedIsPlaceholder`
- `fetchedImage`, `fetchedIsPlaceholder`
- `fetchedImageSource`, `fetchedImageReason`
- `eventSelloutStatus`, `createdAt`

---

## 6) Controlled bulk refresh (rehydrate)

### Route
- `GET /api/debug/tickets/images?take=100&rehydrate=1`

### Base commit
- `47995ea` (`rehydrate=1` mode)

### Behavior
When `rehydrate=1`:
- Recomputes fetched image per ticket.
- Updates `ticket.image` only when fetched image is non-placeholder and stored image is placeholder or different.
- Returns:
  - `rehydrate: true`
  - `rehydratedCount`
  - per-row `rehydrated`

### Fallback enhancement
- Commit: `0cfe018`
- Strategy values:
  - `auto`: use fresh non-placeholder fetch
  - `sibling`: if fetch returns placeholder, copy non-placeholder from sibling ticket with same base title
  - `none`: no update
- Added response fields:
  - `rehydrateStrategy`
  - `updatedImage`

---

## 7) Environment dependency (critical)

Required env var:
- `BRAVE_API_KEY`

Must be set in Vercel envs used by deployment/runtime checks:
- Development
- Preview
- Production

If missing/invalid in active runtime env:
- Brave candidates collapse to none
- Placeholder rate spikes
- Rehydrate appears ineffective (fetched images are placeholders)

---

## 8) Current known-good state (as of 2026-03-07)

After env repair + redeploy + rehydrate:
- Pipeline recovered from all-placeholder failure.
- Stored images repaired across seeded set.
- Latest diagnostic snapshot reached:
  - `storedPlaceholder = 0` for `take=100`
  - small residual `fetchedPlaceholder` instability remains for a subset of titles.

---

## 9) QA checklist
1. Create ticket via `POST /api/tickets`.
2. Confirm response includes `image`, `imageSource`, `imageReason`.
3. Test `GET /api/tickets/image?title=...&eventType=...`.
4. Run diagnostics `GET /api/debug/tickets/images?take=25`.
5. Run rehydrate `GET /api/debug/tickets/images?take=100&rehydrate=1`.
6. Confirm homepage featured + `/tickets` render consistent image behavior.
7. Confirm no accidental domain/routing changes.

---

## 10) Related architecture
- Shared ticket mapping/sorting: `src/lib/ticketsView.ts`
- Shared card component: `src/components/tickets/TicketCard.tsx`
- Homepage + `/tickets` use shared logic.
- Sorting priority:
  1. nearest location
  2. sold-out events first
  3. event date
