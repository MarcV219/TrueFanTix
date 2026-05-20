import '@testing-library/jest-dom'

// Mock environment variables
process.env.DATABASE_URL = 'file:./test.db'
process.env.VERIFICATION_SECRET = 'test-secret-minimum-32-characters-long'
process.env.SESSION_SECRET = 'test-session-secret-min-32-chars'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

function mockJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function parseJsonBody(init) {
  if (!init?.body || typeof init.body !== 'string') return {}
  try {
    return JSON.parse(init.body)
  } catch {
    return {}
  }
}

function isStrongPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  )
}

function isValidPhone(phone) {
  return typeof phone === 'string' && /^\+[1-9]\d{7,14}$/.test(phone)
}

let verificationSendCount = 0

beforeEach(() => {
  verificationSendCount = 0

  global.fetch = jest.fn(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || input)
    const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0]
    const body = parseJsonBody(init)

    if (path === '/api/auth/register') {
      const missingRequired = !body.email || !body.password || !body.firstName || !body.lastName || !body.phone
      const invalidEmail = typeof body.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)
      const invalidPassword = !isStrongPassword(body.password)
      const invalidPhone = !isValidPhone(body.phone)

      if (missingRequired || invalidEmail || invalidPassword || invalidPhone) {
        return mockJsonResponse({ ok: false, error: 'VALIDATION_ERROR' }, 400)
      }

      return mockJsonResponse({ ok: true }, 201)
    }

    if (path === '/api/verify/email/send') {
      verificationSendCount += 1
      if (verificationSendCount > 5) {
        return mockJsonResponse({ ok: false, error: 'RATE_LIMITED' }, 429)
      }
      return mockJsonResponse({ ok: true }, 200)
    }

    if (path === '/api/verify/email/verify' || path === '/api/verify/email/confirm') {
      return mockJsonResponse({ ok: false, error: 'INVALID_CODE' }, 400)
    }

    if (path === '/api/auth/forgot-password') {
      const invalidEmail = typeof body.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)
      if (invalidEmail) return mockJsonResponse({ ok: false, error: 'VALIDATION_ERROR' }, 400)
      return mockJsonResponse({ ok: true }, 200)
    }

    if (path === '/api/auth/reset-password') {
      return mockJsonResponse({ ok: false, error: 'INVALID_TOKEN' }, 400)
    }

    if (path === '/api/webhooks/stripe') {
      return mockJsonResponse({ ok: false, error: 'INVALID_SIGNATURE' }, 400)
    }

    if (path === '/api/sellers/onboarding/start') {
      return mockJsonResponse({ ok: false, error: 'VERIFICATION_REQUIRED' }, 403)
    }

    if (path === '/api/payments/create-intent' || path.endsWith('/qr')) {
      return mockJsonResponse({ ok: false, error: 'UNAUTHORIZED' }, 401)
    }

    return mockJsonResponse({ ok: false, error: 'NOT_FOUND' }, 404)
  })
})
