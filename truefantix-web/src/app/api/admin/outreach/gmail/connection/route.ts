export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { disconnectGmail, gmailConnectionStatus } from "@/lib/integrations/gmail";
import { auditLog, createAuditContext } from "@/lib/audit";
export async function GET(req: Request) { const gate = await requireAdmin(req); if (!gate.ok) return gate.res; return NextResponse.json({ ok: true, ...(await gmailConnectionStatus(gate.user.id)) }); }
export async function DELETE(req: Request) { const gate = await requireAdmin(req); if (!gate.ok) return gate.res; await disconnectGmail(gate.user.id); await auditLog({ action: "ADMIN_OUTREACH_DISCONNECT", userId: gate.user.id, targetType: "ConnectedAccount", metadata: { provider: "gmail" }, ...createAuditContext(req) }); return NextResponse.json({ ok: true }); }
