"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Actor = { id: string; email: string; firstName: string | null; lastName: string | null; role: "USER" | "ADMIN" };
type TicketType = {
  id: string; name: string; description: string | null; allocatedQuantity: number; status: "ACTIVE" | "INACTIVE";
  minimumPerOrder: number | null; maximumPerOrder: number | null; currency: string; basePriceMinor: number;
};
type EventRecord = {
  id: string; title: string; description?: string; category: string; status: string; statusReason: string | null;
  venueName: string; venueAddressLine1?: string; venueAddressLine2?: string | null; venueCity?: string; venueRegion?: string;
  venuePostalCode?: string; venueCountry?: string; startsAtLocal: string; endsAtLocal: string; timezone: string;
  accessibilityInfo?: string | null; contactEmail: string; contactPhone?: string | null; draftPolicyText?: string;
  totalCapacity: number; ticketTypes: TicketType[];
};
type Organizer = {
  id: string; displayName: string; legalName: string; status: string; statusReason: string | null; supportEmail: string;
  createdAt: string; memberships: Array<{ id: string; userId: string; role: string; status: string }>; events: EventRecord[];
};
type AuditEvent = {
  id: string; organizerId: string | null; eventId: string | null; actorUserId: string | null; action: string;
  targetType: string; targetId: string; reason: string | null; createdAt: string;
};
type ConsoleState = { actor: Actor; organizers: Organizer[]; audit: AuditEvent[] };

const initialEvent = {
  title: "Synthetic Toronto Concert",
  description: "Synthetic staging event used only to verify the organizer workflow.",
  category: "Concert",
  venueName: "Synthetic Hall",
  venueAddressLine1: "1 Test Avenue",
  venueAddressLine2: "",
  venueCity: "Toronto",
  venueRegion: "ON",
  venuePostalCode: "M5V 0A1",
  venueCountry: "CA",
  startsAtLocal: "2027-06-15T19:00",
  endsAtLocal: "2027-06-15T22:00",
  timezone: "America/Toronto",
  accessibilityInfo: "Synthetic accessible entrance information.",
  contactEmail: "organizer@primary-staging.example.invalid",
  contactPhone: "+15550001001",
  draftPolicyText: "Synthetic draft policy for staging verification only.",
  totalCapacity: 100,
};

function csrfToken() {
  const match = document.cookie.split("; ").find((entry) => entry.startsWith("tft_csrf="));
  return match ? decodeURIComponent(match.slice("tft_csrf=".length)) : "";
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected staging console error.";
}

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm";
const buttonClass = "rounded-lg bg-[#064a93] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50";

export default function PrimaryStagingConsole() {
  const [actor, setActor] = useState<Actor | null>(null);
  const [state, setState] = useState<ConsoleState | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [notice, setNotice] = useState("Loading staging session…");
  const [busy, setBusy] = useState(false);
  const [eventOrganizerId, setEventOrganizerId] = useState("");
  const [eventId, setEventId] = useState("");
  const [eventDraft, setEventDraft] = useState(initialEvent);
  const [ticketEventId, setTicketEventId] = useState("");
  const [reviewReason, setReviewReason] = useState("Reviewed and approved in isolated staging.");

  const loadState = useCallback(async () => {
    const response = await fetch("/api/staging/primary/state", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load staging state.");
    setState(body);
    setActor(body.actor);
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch("/api/staging/primary/session", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Staging console unavailable.");
      setActor(body.actor);
      if (body.actor) {
        await loadState();
        setNotice(`Signed in as ${body.actor.email}.`);
      } else {
        setState(null);
        setNotice("Enter the staging access token, then choose a synthetic persona.");
      }
    } catch (error) {
      setNotice(messageFor(error));
    }
  }, [loadState]);

  useEffect(() => { void loadSession(); }, [loadSession]);

  async function switchPersona(persona: "organizer" | "admin" | "none") {
    setBusy(true);
    try {
      const response = await fetch("/api/staging/primary/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
          ...(persona === "none" ? {} : { "x-primary-staging-access-token": accessToken }),
        },
        body: JSON.stringify({ persona }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to change staging persona.");
      setAccessToken("");
      setActor(body.actor);
      if (body.actor) await loadState(); else setState(null);
      setNotice(body.actor ? `Signed in as ${body.actor.email}.` : "Signed out of the staging console.");
    } catch (error) {
      setNotice(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function runAction(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/staging/primary/actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Staging action failed.");
      await loadState();
      setNotice(success);
      return body.result;
    } catch (error) {
      setNotice(messageFor(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createOrganizer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await runAction({ action: "createOrganizer", ...values }, "Synthetic organizer created with an OWNER membership.");
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await runAction({
      action: eventId ? "editEvent" : "createEvent",
      organizerId: eventOrganizerId,
      ...(eventId ? { eventId } : {}),
      ...eventDraft,
    }, eventId ? "Draft event updated." : "Draft event created.");
    if (result) {
      setEventId("");
      setEventDraft(initialEvent);
    }
  }

  function editEvent(organizerId: string, event: EventRecord) {
    setEventOrganizerId(organizerId);
    setEventId(event.id);
    setEventDraft({
      title: event.title,
      description: event.description ?? "",
      category: event.category,
      venueName: event.venueName,
      venueAddressLine1: event.venueAddressLine1 ?? "",
      venueAddressLine2: event.venueAddressLine2 ?? "",
      venueCity: event.venueCity ?? "",
      venueRegion: event.venueRegion ?? "",
      venuePostalCode: event.venuePostalCode ?? "",
      venueCountry: event.venueCountry ?? "CA",
      startsAtLocal: event.startsAtLocal.slice(0, 16),
      endsAtLocal: event.endsAtLocal.slice(0, 16),
      timezone: event.timezone,
      accessibilityInfo: event.accessibilityInfo ?? "",
      contactEmail: event.contactEmail,
      contactPhone: event.contactPhone ?? "",
      draftPolicyText: event.draftPolicyText ?? "",
      totalCapacity: event.totalCapacity,
    });
    document.getElementById("event-editor")?.scrollIntoView({ behavior: "smooth" });
  }

  async function createTicketType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const organizer = state?.organizers.find((item) => item.events.some((candidate) => candidate.id === ticketEventId));
    if (!organizer) return setNotice("Choose a draft event first.");
    await runAction({ action: "createTicketType", organizerId: organizer.id, eventId: ticketEventId, ...values }, "Ticket type created.");
  }

  const ownerOrganizers = state?.organizers.filter((organizer) => organizer.memberships.some((member) => member.userId === actor?.id && member.role === "OWNER")) ?? [];
  const draftEvents = ownerOrganizers.flatMap((organizer) => organizer.events.filter((event) => event.status === "DRAFT"));

  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-6 bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
      <header className="rounded-2xl bg-[#0b2e4e] p-6 text-white shadow-lg">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Isolated staging only</p>
        <h1 className="mt-2 text-3xl font-bold !text-white">Primary organizer test console</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-200">Synthetic data only. This interface has no payment, email, refund, payout, webhook, cron, QR, or public-ticketing behavior.</p>
      </header>

      <section aria-label="Console status" className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm" role="status">
        {busy ? "Working… " : ""}{notice}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Synthetic access</h2>
        {!actor ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <label className="text-sm font-medium">Staging access token
              <input className={`${inputClass} mt-1`} type="password" autoComplete="off" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} />
            </label>
            <button className={`${buttonClass} self-end`} disabled={busy || accessToken.length < 32} onClick={() => void switchPersona("organizer")}>Use organizer</button>
            <button className={`${buttonClass} self-end`} disabled={busy || accessToken.length < 32} onClick={() => void switchPersona("admin")}>Use admin</button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span><strong>{actor.role === "ADMIN" ? "Admin reviewer" : "Organizer owner"}</strong> · {actor.email}</span>
            <button className={secondaryButtonClass} disabled={busy} onClick={() => void switchPersona("none")}>Sign out</button>
          </div>
        )}
      </section>

      {actor?.role === "USER" && (
        <>
          <form onSubmit={createOrganizer} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold">1. Create organizer</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm">Legal name<input name="legalName" required defaultValue="Synthetic Events Ontario Inc." className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Display name<input name="displayName" required defaultValue="Synthetic Events" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Support email<input name="supportEmail" type="email" required defaultValue="support@primary-staging.example.invalid" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Address<input name="addressLine1" required defaultValue="1 Synthetic Way" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">City<input name="city" required defaultValue="Toronto" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Province<input name="region" required defaultValue="ON" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Postal code<input name="postalCode" required defaultValue="M5V 0A1" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Country<input name="country" required defaultValue="CA" className={`${inputClass} mt-1`} /></label>
            </div>
            <button className={`${buttonClass} mt-4`} disabled={busy}>Create organizer</button>
          </form>

          <form id="event-editor" onSubmit={saveEvent} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold">2. {eventId ? "Edit" : "Create"} draft event</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm">Approved organizer<select required className={`${inputClass} mt-1`} value={eventOrganizerId} onChange={(event) => setEventOrganizerId(event.target.value)}><option value="">Choose…</option>{ownerOrganizers.filter((item) => item.status === "APPROVED").map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
              {Object.entries(eventDraft).map(([key, value]) => (
                <label className={`text-sm ${["description", "draftPolicyText", "accessibilityInfo"].includes(key) ? "lg:col-span-2" : ""}`} key={key}>
                  {key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}
                  <input className={`${inputClass} mt-1`} type={key.includes("AtLocal") ? "datetime-local" : key === "totalCapacity" ? "number" : key.toLowerCase().includes("email") ? "email" : "text"} required={!key.endsWith("Line2") && !["accessibilityInfo", "contactPhone"].includes(key)} value={value} onChange={(event) => setEventDraft((current) => ({ ...current, [key]: key === "totalCapacity" ? Number(event.target.value) : event.target.value }))} />
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-3"><button className={buttonClass} disabled={busy || !eventOrganizerId}>{eventId ? "Save changes" : "Create draft event"}</button>{eventId && <button type="button" className={secondaryButtonClass} onClick={() => { setEventId(""); setEventDraft(initialEvent); }}>Cancel edit</button>}</div>
          </form>

          <form onSubmit={createTicketType} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold">3. Add general-admission ticket type</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm">Draft event<select required className={`${inputClass} mt-1`} value={ticketEventId} onChange={(event) => setTicketEventId(event.target.value)}><option value="">Choose…</option>{draftEvents.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
              <label className="text-sm">Name<input name="name" required defaultValue="General admission" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Allocation<input name="allocatedQuantity" type="number" min="1" required defaultValue="100" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Price in cents<input name="basePriceMinor" type="number" min="1" required defaultValue="5000" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Currency<input name="currency" required defaultValue="CAD" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Minimum/order<input name="minimumPerOrder" type="number" min="1" defaultValue="1" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm">Maximum/order<input name="maximumPerOrder" type="number" min="1" defaultValue="8" className={`${inputClass} mt-1`} /></label>
              <input type="hidden" name="status" value="ACTIVE" /><input type="hidden" name="description" value="Synthetic staging inventory" />
            </div>
            <button className={`${buttonClass} mt-4`} disabled={busy || !ticketEventId}>Create ticket type</button>
          </form>
        </>
      )}

      {actor && state && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Workflow state</h2>
          {actor.role === "ADMIN" && <label className="mt-4 block text-sm">Review evidence/reason<input className={`${inputClass} mt-1`} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label>}
          <div className="mt-4 space-y-4">
            {state.organizers.length === 0 && <p className="text-sm text-slate-600">No visible synthetic organizers yet.</p>}
            {state.organizers.map((organizer) => (
              <article key={organizer.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">{organizer.displayName}</h3><p className="text-xs text-slate-500">{organizer.id}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{organizer.status}</span></div>
                <p className="mt-2 text-sm">{organizer.legalName} · {organizer.supportEmail} · {organizer.memberships.length} active member(s)</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {actor.role === "USER" && organizer.status === "DRAFT" && <button className={buttonClass} disabled={busy} onClick={() => void runAction({ action: "submitOrganizer", organizerId: organizer.id }, "Organizer submitted for admin review.")}>Submit organizer</button>}
                  {actor.role === "ADMIN" && organizer.status === "SUBMITTED" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void runAction({ action: "reviewOrganizer", organizerId: organizer.id, toStatus: "UNDER_REVIEW", reason: reviewReason }, "Organizer moved to review.")}>Start review</button>}
                  {actor.role === "ADMIN" && organizer.status === "UNDER_REVIEW" && <button className={buttonClass} disabled={busy} onClick={() => void runAction({ action: "reviewOrganizer", organizerId: organizer.id, toStatus: "APPROVED", reason: reviewReason }, "Organizer approved.")}>Approve organizer</button>}
                </div>
                <div className="mt-4 space-y-3">
                  {organizer.events.map((event) => (
                    <div key={event.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{event.title}</strong><span>{event.status}</span></div>
                      <p className="mt-1 text-slate-600">{event.venueName} · {event.totalCapacity} capacity · {event.ticketTypes.length} ticket type(s)</p>
                      {event.ticketTypes.map((ticket) => <p className="mt-1 text-xs" key={ticket.id}>{ticket.name}: {ticket.allocatedQuantity} × {(ticket.basePriceMinor / 100).toLocaleString("en-CA", { style: "currency", currency: ticket.currency })}</p>)}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {actor.role === "USER" && event.status === "DRAFT" && <><button className={secondaryButtonClass} disabled={busy} onClick={() => editEvent(organizer.id, event)}>Edit draft</button><button className={buttonClass} disabled={busy || event.ticketTypes.filter((ticket) => ticket.status === "ACTIVE").length === 0} onClick={() => void runAction({ action: "submitEvent", organizerId: organizer.id, eventId: event.id }, "Event submitted for admin review.")}>Submit event</button></>}
                        {actor.role === "ADMIN" && event.status === "SUBMITTED" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void runAction({ action: "reviewEvent", organizerId: organizer.id, eventId: event.id, toStatus: "UNDER_REVIEW", reason: reviewReason }, "Event moved to review.")}>Start event review</button>}
                        {actor.role === "ADMIN" && event.status === "UNDER_REVIEW" && <button className={buttonClass} disabled={busy} onClick={() => void runAction({ action: "reviewEvent", organizerId: organizer.id, eventId: event.id, toStatus: "APPROVED", reason: reviewReason }, "Event approved.")}>Approve event</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {actor && state && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Audit evidence</h2>
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead><tr className="border-b"><th className="p-2">Time</th><th className="p-2">Action</th><th className="p-2">Target</th><th className="p-2">Actor</th><th className="p-2">Reason</th></tr></thead><tbody>{state.audit.map((entry) => <tr key={entry.id} className="border-b border-slate-100"><td className="p-2">{new Date(entry.createdAt).toLocaleString()}</td><td className="p-2 font-semibold">{entry.action}</td><td className="p-2">{entry.targetType}<br />{entry.targetId}</td><td className="p-2">{entry.actorUserId}</td><td className="p-2">{entry.reason ?? "—"}</td></tr>)}</tbody></table></div>
        </section>
      )}
    </main>
  );
}
