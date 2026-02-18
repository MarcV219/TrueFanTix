import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "tft_session";
const SESSION_DAYS = 30;

// IMPORTANT: set this in your .env (we'll do next step)
function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set SESSION_SECRET in .env (min 32 chars)."
    );
  }
  return secret;
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex"); // 64 chars
}

export function createSessionToken() {
  const token = randomToken();
  const secret = getSessionSecret();
  // Token hash stored in DB = hash(secret + token) so stolen DB can't mint sessions
  const tokenHash = sha256(secret + token);
  return { token, tokenHash };
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function createSessionForUser(userId: string) {
  const { token, tokenHash } = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  await setSessionCookie(token);
}

export async function getUserIdFromSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const secret = getSessionSecret();
  const tokenHash = sha256(secret + token);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: { userId: true, expiresAt: true },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  return session.userId;
}

export async function deleteCurrentSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) {
    await clearSessionCookie();
    return;
  }

  const secret = getSessionSecret();
  const tokenHash = sha256(secret + token);

  // Best-effort delete
  await prisma.session
    .delete({ where: { tokenHash } })
    .catch(() => undefined);

  await clearSessionCookie();
}
