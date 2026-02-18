import '@testing-library/jest-dom'

// Mock environment variables
process.env.DATABASE_URL = 'file:./test.db'
process.env.VERIFICATION_SECRET = 'test-secret-minimum-32-characters-long'
process.env.SESSION_SECRET = 'test-session-secret-min-32-chars'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
