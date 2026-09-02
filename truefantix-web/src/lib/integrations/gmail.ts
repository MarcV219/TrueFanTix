import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const PROVIDER = "gmail";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API_BASE = "https://gmail.googleapis.com/gmail/v1";
const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function clean(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "");
}

function required(name: string) {
  const value = clean(process.env[name]);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function appOrigin() {
  const configured = clean(process.env.APP_ORIGIN) || clean(process.env.NEXT_PUBLIC_APP_URL);
  return configured ? new URL(configured).origin : "http://localhost:3000";
}

export function gmailRedirectUri() {
  return clean(process.env.GOOGLE_GMAIL_REDIRECT_URI) || `${appOrigin()}/api/admin/outreach/gmail/callback`;
}

export function gmailConfigured() {
  return Boolean(clean(process.env.GOOGLE_GMAIL_CLIENT_ID) && clean(process.env.GOOGLE_GMAIL_CLIENT_SECRET) && clean(process.env.OUTREACH_FROM_EMAIL));
}

export function outreachFromEmail() {
  return required("OUTREACH_FROM_EMAIL").toLowerCase();
}

export function gmailAuthorizeUrl(state: string) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", required("GOOGLE_GMAIL_CLIENT_ID"));
  url.searchParams.set("redirect_uri", gmailRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SEND_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  return url.toString();
}

function key() {
  const secret = clean(process.env.GMAIL_TOKEN_ENCRYPTION_KEY) || clean(process.env.SESSION_SECRET);
  if (!secret || secret.length < 32) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY or SESSION_SECRET must be at least 32 characters.");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptGmailToken(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptGmailToken(value: string) {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("Invalid encrypted Gmail token.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

async function tokenRequest(body: URLSearchParams) {
  body.set("client_id", required("GOOGLE_GMAIL_CLIENT_ID"));
  body.set("client_secret", required("GOOGLE_GMAIL_CLIENT_SECRET"));
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error_description || data?.error || `Google token request failed (${response.status}).`);
  return data as { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
}

export async function exchangeGmailCode(code: string) {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: gmailRedirectUri() });
  return tokenRequest(body);
}

export async function storeGmailConnection(userId: string, token: Awaited<ReturnType<typeof exchangeGmailCode>>) {
  const sender = outreachFromEmail();
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
  return prisma.connectedAccount.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, providerAccountId: sender, email: sender, displayName: sender, accessTokenEncrypted: encryptGmailToken(token.access_token), refreshTokenEncrypted: token.refresh_token ? encryptGmailToken(token.refresh_token) : null, tokenType: token.token_type || "Bearer", scope: token.scope || SEND_SCOPE, expiresAt },
    update: { providerAccountId: sender, email: sender, displayName: sender, accessTokenEncrypted: encryptGmailToken(token.access_token), refreshTokenEncrypted: token.refresh_token ? encryptGmailToken(token.refresh_token) : undefined, tokenType: token.token_type || "Bearer", scope: token.scope || SEND_SCOPE, expiresAt },
  });
}

async function accountFor(userId: string) {
  return prisma.connectedAccount.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } } });
}

export async function gmailConnectionStatus(userId: string) {
  const account = await accountFor(userId);
  return account ? { connected: true, email: account.email, expiresAt: account.expiresAt, configured: gmailConfigured() } : { connected: false, email: null, expiresAt: null, configured: gmailConfigured() };
}

async function accessToken(userId: string) {
  const account = await accountFor(userId);
  if (!account) throw new Error("Connect Gmail before sending.");
  if (!account.expiresAt || account.expiresAt.getTime() > Date.now() + 60_000) return decryptGmailToken(account.accessTokenEncrypted);
  if (!account.refreshTokenEncrypted) throw new Error("Gmail authorization expired. Reconnect Gmail.");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptGmailToken(account.refreshTokenEncrypted) });
  const token = await tokenRequest(body);
  await prisma.connectedAccount.update({ where: { id: account.id }, data: { accessTokenEncrypted: encryptGmailToken(token.access_token), refreshTokenEncrypted: token.refresh_token ? encryptGmailToken(token.refresh_token) : undefined, expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null, scope: token.scope || undefined } });
  return token.access_token;
}

export async function disconnectGmail(userId: string) {
  const account = await accountFor(userId);
  if (!account) return;
  const token = account.refreshTokenEncrypted ? decryptGmailToken(account.refreshTokenEncrypted) : decryptGmailToken(account.accessTokenEncrypted);
  await fetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }).catch(() => null);
  await prisma.connectedAccount.delete({ where: { id: account.id } });
}

function header(value: string) {
  if (/\r|\n/.test(value)) throw new Error("Email headers cannot contain line breaks.");
  return value;
}

export function renderMerge(value: string, vars: Record<string, string | null | undefined>) {
  return value.replace(/{{\s*([a-zA-Z][\w]*)\s*}}/g, (_match, key) => vars[key] || "");
}

export function buildGmailRaw(input: { to: string; from: string; subject: string; text: string; unsubscribeUrl: string }) {
  const message = [
    `From: ${header(input.from)}`,
    `To: ${header(input.to)}`,
    `Subject: ${header(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    `List-Unsubscribe: <${header(input.unsubscribeUrl)}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    "",
    input.text.replace(/\r?\n/g, "\r\n"),
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}

export async function sendGmail(userId: string, input: { to: string; subject: string; text: string; unsubscribeUrl: string }) {
  const token = await accessToken(userId);
  const response = await fetch(`${API_BASE}/users/me/messages/send`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: buildGmailRaw({ ...input, from: outreachFromEmail() }) }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Gmail send failed (${response.status}).`);
  return { id: String(data.id), threadId: data.threadId ? String(data.threadId) : null };
}
