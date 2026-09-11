export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createSessionForUser, deleteCurrentSession } from "@/lib/auth/session";
import { ensureCsrfCookie, enforceOriginAndCsrf } from "@/lib/security/csrf";
import {
  ensurePrimaryStagingPersona,
  PrimaryStagingConsoleUnavailableError,
  requirePrimaryStagingActor,
  requirePrimaryStagingConsole,
  type StagingPersona,
  verifyPrimaryStagingAccessToken,
} from "@/lib/primary/staging-console";

function unavailable() {
  return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
}

export async function GET() {
  try {
    requirePrimaryStagingConsole();
    const actor = await requirePrimaryStagingActor();
    const response = NextResponse.json({ ok: true, actor });
    await ensureCsrfCookie(response);
    return response;
  } catch (error) {
    if (error instanceof PrimaryStagingConsoleUnavailableError) return unavailable();
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    requirePrimaryStagingConsole();
    const csrf = await enforceOriginAndCsrf(req);
    if (!csrf.ok) return csrf.res;
    const body = (await req.json().catch(() => null)) as { persona?: StagingPersona | "none" } | null;
    if (!body || !["organizer", "admin", "none"].includes(body.persona ?? "")) {
      return NextResponse.json({ ok: false, error: "INVALID_PERSONA" }, { status: 400 });
    }

    if (body.persona === "none") {
      await deleteCurrentSession();
      return NextResponse.json({ ok: true, actor: null });
    }

    if (!verifyPrimaryStagingAccessToken(req.headers.get("x-primary-staging-access-token"))) {
      return NextResponse.json({ ok: false, error: "INVALID_ACCESS_TOKEN" }, { status: 401 });
    }

    await deleteCurrentSession();
    const actor = await ensurePrimaryStagingPersona(body.persona as StagingPersona);
    await createSessionForUser(actor.id);
    return NextResponse.json({ ok: true, actor });
  } catch (error) {
    if (error instanceof PrimaryStagingConsoleUnavailableError) return unavailable();
    throw error;
  }
}
