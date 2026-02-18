import crypto from "crypto";

export function getVerificationSecret() {
  const s = process.env.VERIFICATION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "VERIFICATION_SECRET is missing or too short. Set VERIFICATION_SECRET in .env (min 32 chars)."
    );
  }
  return s;
}

export function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function generate6DigitCode() {
  // 000000–999999 (padded)
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

export function hashVerificationCode(code: string) {
  // DB stores sha256(VERIFICATION_SECRET + code)
  const secret = getVerificationSecret();
  return sha256Hex(secret + code);
}

export function isSixDigitCode(code: string) {
  return /^\d{6}$/.test(code);
}
