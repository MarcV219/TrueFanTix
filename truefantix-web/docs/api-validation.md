# API Validation & Error Contract (TrueFanTix)

This document defines how API request validation works and the response shape clients should expect.

## Validation approach

All API route input validation is centralized in:

- `src/lib/validation.ts`

Primary helpers:

- `validateRequest(schema)`
  - For required JSON body routes.
- `validateOptionalRequest(schema)`
  - For routes where body is optional (empty body is treated as `{}`).

## Standard validation error responses

### Invalid JSON body

Returned when request body cannot be parsed as JSON (for required or optional-body helpers).

```json
{
  "ok": false,
  "error": "INVALID_JSON",
  "message": "Could not parse request body"
}
```

Status: `400`

### Schema validation failed

Returned when parsed body/query does not match schema constraints.

```json
{
  "ok": false,
  "error": "VALIDATION_ERROR",
  "message": "Invalid request data",
  "details": [
    "field.path: message"
  ]
}
```

Status: `400`

> Note: Some legacy routes may still use a route-specific message while keeping `error = VALIDATION_ERROR`.

## Optional-body behavior

For routes using `validateOptionalRequest(schema)`:

- Empty body (`""`) is treated as `{}`
- Schema defaults are applied normally

Example currently used by:

- `POST /api/tickets/verify/pending`
- `POST /api/tickets/[id]/escrow/deposit`

## Auth / CSRF / permission errors (not validation)

These are separate from validation and may return:

- `401` (not authenticated)
- `403` (forbidden / missing CSRF / role restrictions)
- domain-specific errors such as `BANNED`, `FORBIDDEN`, etc.

Clients should handle these independently from `VALIDATION_ERROR`.

## High-risk routes covered by integration checks

Live integration tests currently verify baseline contract behavior for:

- `POST /api/orders/checkout`
- `POST /api/auth/register`
- `POST /api/auth/forgot-password`
- `POST /api/payments/create-intent`
- `POST /api/tickets/[id]/purchase`

Test file:

- `src/__tests__/api.live.integration.test.ts`

## Developer guidance

When adding new mutation routes:

1. Define schema in `src/lib/validation.ts`
2. Use `validateRequest` or `validateOptionalRequest`
3. Keep response errors consistent with this document
4. Add at least one contract test for bad payload handling
