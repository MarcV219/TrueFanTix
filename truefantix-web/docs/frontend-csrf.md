# Frontend CSRF plumbing

Frontend mutating API calls should use `apiFetch` / `fetchJson` from `src/lib/api-fetch.ts`.

What it does automatically:

1. Ensures CSRF cookie/token exists via `GET /api/auth/csrf`.
2. Adds `x-csrf-token` on mutating methods (`POST`, `PATCH`, `PUT`, `DELETE`).
3. If a mutating request fails with `403` + `CSRF_MISSING`/`CSRF_INVALID`, it refreshes the token and retries once.

Usage:

```ts
import { apiFetch, fetchJson } from "@/lib/api-fetch";

await apiFetch("/api/auth/logout", { method: "POST" });

const { res, data } = await fetchJson("/api/account/security/password", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ currentPassword, newPassword }),
});
```

Notes:
- Safe methods (`GET`/`HEAD`/`OPTIONS`) do not attach CSRF headers.
- Existing explicit `x-csrf-token` headers are respected on first attempt.
- This helper is intended for browser-side use.
