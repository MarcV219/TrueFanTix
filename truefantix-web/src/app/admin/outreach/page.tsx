"use client";
import React from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";

type Contact = {
  id: string;
  organization: string | null;
  subjectName: string | null;
  contactName: string | null;
  role: string | null;
  email: string | null;
  category: string;
  league: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
  confidence: string | null;
  researchStatus: string | null;
  consentBasis: string;
  consentEvidence: string | null;
  lastContactedAt: string | null;
  engagementStage: string;
  followUpAt: string | null;
  adminNotes: string | null;
  unsubscribedAt: string | null;
  suppressionReason: string | null;
};
type Campaign = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  _count: { recipients: number };
  statusCounts: Record<string, number>;
  allowRecentContact: boolean;
};
type CampaignRecipient = {
  id: string;
  emailSnapshot: string;
  subjectSnapshot: string;
  bodyTextSnapshot: string;
  bodyHtmlSnapshot: string | null;
  status: string;
  contact: {
    contactName: string | null;
    organization: string | null;
    subjectName: string | null;
    role: string | null;
  };
};
type CampaignReview = {
  id: string;
  name: string;
  status: string;
  recipients: CampaignRecipient[];
};
type Template = {
  id: string;
  name: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
};
type Dashboard = {
  campaignCount: number;
  recipients: Record<string, number>;
  suppressions: Record<string, number>;
  webhookConfigured: boolean;
  recentEvents: Array<{
    id: string;
    type: string;
    email: string;
    occurredAt: string;
    detail: string | null;
    campaignName: string;
  }>;
};
const field: React.CSSProperties = {
  padding: "9px 10px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,.16)",
  background: "white",
};
const button: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,.16)",
  background: "white",
  fontWeight: 800,
  cursor: "pointer",
};
const ontarioDateTimeInput = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
};
const dialogBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "rgba(15, 23, 42, .55)",
};
const dialogPanel: React.CSSProperties = {
  width: "min(760px, 100%)",
  maxHeight: "calc(100vh - 32px)",
  overflowY: "auto",
  padding: 16,
  borderRadius: 10,
  boxShadow: "0 20px 50px rgba(0, 0, 0, .25)",
};
const researchLabels: Record<string, string> = {
  PENDING: "Not researched",
  RESEARCHED: "Researched",
  VERIFIED: "Verified",
  CONTACT_FORM_ONLY: "Contact form only",
  NO_PUBLIC_CONTACT: "Researched—no public contact",
  NEEDS_REVIEW: "Needs review",
};
const researchColors: Record<string, string> = {
  PENDING: "#fef3c7",
  RESEARCHED: "#dcfce7",
  VERIFIED: "#dcfce7",
  CONTACT_FORM_ONLY: "#e0f2fe",
  NO_PUBLIC_CONTACT: "#f1f5f9",
  NEEDS_REVIEW: "#fee2e2",
};
const categoryLabels: Record<string, string> = {
  ARTIST: "Artists",
  SPORTS_BASEBALL: "Baseball",
  SPORTS_BASKETBALL: "Basketball",
  SPORTS_FOOTBALL: "Football",
  SPORTS_HOCKEY: "Hockey",
  SPORTS_SOCCER: "Soccer",
  SPORTS_COLLEGE_OTHER: "College / university — Other",
  SPORTS_OTHER: "Other sports",
  TEST_CONTACT: "Test contacts",
};
const stages = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "FOLLOW_UP",
  "NOT_INTERESTED",
  "CLOSED",
];
const MAX_CAMPAIGN_CONTACTS = 20;

function plainTextHtml(value: string) {
  return value
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p>${block.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
}
function safePreviewHtml(value: string) {
  if (typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(value, "text/html"),
    allowed = new Set([
      "P",
      "DIV",
      "BR",
      "STRONG",
      "B",
      "EM",
      "I",
      "U",
      "UL",
      "OL",
      "LI",
      "A",
    ]);
  for (const element of [...doc.body.querySelectorAll("*")]) {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attr of [...element.attributes])
      if (
        element.tagName !== "A" ||
        !["href", "title", "target"].includes(attr.name)
      )
        element.removeAttribute(attr.name);
    if (
      element.tagName === "A" &&
      !/^(https?:|mailto:)/i.test(element.getAttribute("href") || "")
    )
      element.removeAttribute("href");
  }
  return doc.body.innerHTML;
}
function RichTextEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (html: string, text: string) => void;
  readOnly?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value)
      ref.current.innerHTML = value;
  }, [value]);
  const update = () =>
    onChange(ref.current?.innerHTML || "", ref.current?.innerText || "");
  const command = (name: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    update();
  };
  return (
    <div>
      <div
        style={{
          display: readOnly ? "none" : "flex",
          gap: 6,
          flexWrap: "wrap",
          padding: "7px",
          border: "1px solid #d1d5db",
          borderBottom: 0,
          borderRadius: "8px 8px 0 0",
          background: "#f8fafc",
        }}
      >
        <button
          type="button"
          style={button}
          onClick={() => command("bold")}
          title="Bold"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          style={button}
          onClick={() => command("italic")}
          title="Italic"
        >
          <em>I</em>
        </button>
        <button
          type="button"
          style={button}
          onClick={() => command("underline")}
          title="Underline"
        >
          <u>U</u>
        </button>
        <button
          type="button"
          style={button}
          onClick={() => command("insertUnorderedList")}
        >
          • List
        </button>
        <button
          type="button"
          style={button}
          onClick={() => command("insertOrderedList")}
        >
          1. List
        </button>
        <button
          type="button"
          style={button}
          onClick={() => {
            const url = prompt("Link address (https://…)");
            if (url) command("createLink", url);
          }}
        >
          Add link
        </button>
        <button
          type="button"
          style={button}
          onClick={() => command("removeFormat")}
        >
          Clear formatting
        </button>
      </div>
      <div
        ref={ref}
        className="outreach-rich-content"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={update}
        style={{
          ...field,
          minHeight: 260,
          borderRadius: readOnly ? 8 : "0 0 8px 8px",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 16,
          lineHeight: 1.55,
          outline: "none",
          background: readOnly ? "#f8fafc" : "white",
        }}
      />
      {!readOnly && (
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 5 }}>
          Paste from Word here. Safe bold, italics, lists, links, and paragraph
          spacing are preserved; Word-only fonts and layout effects are removed
          for reliable email display.
        </div>
      )}
    </div>
  );
}

async function jsonFetch(url: string, options?: RequestInit) {
  const res = await apiFetch(url, options);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok)
    throw new Error(data?.message || data?.error || "Request failed.");
  return data;
}
export default function OutreachPage() {
  const gmailAutoSyncStarted = React.useRef(false);
  const [contacts, setContacts] = React.useState<Contact[]>([]),
    [campaigns, setCampaigns] = React.useState<Campaign[]>([]),
    [templates, setTemplates] = React.useState<Template[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set()),
    [q, setQ] = React.useState(""),
    [category, setCategory] = React.useState(""),
    [league, setLeague] = React.useState(""),
    [city, setCity] = React.useState(""),
    [team, setTeam] = React.useState(""),
    [emailFilter, setEmailFilter] = React.useState(""),
    [researchStatus, setResearchStatus] = React.useState(""),
    [sendable, setSendable] = React.useState(false);
  const [categories, setCategories] = React.useState<string[]>([]),
    [leagues, setLeagues] = React.useState<string[]>([]),
    [cities, setCities] = React.useState<string[]>([]),
    [teams, setTeams] = React.useState<string[]>([]),
    [researchStatuses, setResearchStatuses] = React.useState<string[]>([]),
    [filterCounts, setFilterCounts] = React.useState<Record<string, Record<string, number>>>({}),
    [count, setCount] = React.useState(0),
    [totalCount, setTotalCount] = React.useState(0),
    [page, setPage] = React.useState(1),
    [pageSize] = React.useState(100);
  const [error, setError] = React.useState<string | null>(null),
    [notice, setNotice] = React.useState<string | null>(null),
    [loading, setLoading] = React.useState(true);
  const [delivery, setDelivery] = React.useState<{
      configured: boolean;
      sender: string;
      replyCaptureConfigured: boolean;
      replyDomain: string;
    } | null>(null),
    [gmailMatching, setGmailMatching] = React.useState<{ configured: boolean } | null>(null),
    [dashboard, setDashboard] = React.useState<Dashboard | null>(null);
  const [timeline, setTimeline] = React.useState<any | null>(null);
  const [communicationContact, setCommunicationContact] = React.useState<Contact | null>(null);
  const [communication, setCommunication] = React.useState({
    type: "CALL",
    occurredAt: ontarioDateTimeInput(),
    subject: "",
    notes: "",
    followUpAt: "",
  });
  const [review, setReview] = React.useState<CampaignReview | null>(null),
    [reviewIndex, setReviewIndex] = React.useState(0),
    [reviewDraft, setReviewDraft] = React.useState({
      subject: "",
      bodyText: "",
      bodyHtml: "",
    }),
    [reviewSaving, setReviewSaving] = React.useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = React.useState(false),
    [reviewTemplateId, setReviewTemplateId] = React.useState("");
  const [compose, setCompose] = React.useState({
    name: "",
    subject: "",
    bodyText: "Hi {{firstName}},\n\n\n\nThanks,\nMarc\nTrueFanTix",
    bodyHtml:
      "<p>Hi {{firstName}},</p><p><br></p><p>Thanks,<br>Marc<br>TrueFanTix</p>",
    allowRecentContact: false,
  });
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        take: String(pageSize),
        page: String(page),
      });
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      if (league) params.set("league", league);
      if (city) params.set("city", city);
      if (team) params.set("team", team);
      if (emailFilter) params.set("email", emailFilter);
      if (researchStatus) params.set("researchStatus", researchStatus);
      if (sendable) params.set("sendable", "true");
      const [c, ca, t, d, db, gm] = await Promise.all([
        jsonFetch(`/api/admin/outreach/contacts?${params}`),
        jsonFetch("/api/admin/outreach/campaigns"),
        jsonFetch("/api/admin/outreach/templates"),
        jsonFetch("/api/admin/outreach/delivery-status"),
        jsonFetch("/api/admin/outreach/dashboard"),
        jsonFetch("/api/admin/outreach/gmail-sync"),
      ]);
      setContacts(c.items);
      setCategories(c.categories);
      setLeagues(c.leagues);
      setCities(c.cities);
      setTeams(c.teams);
      setResearchStatuses(c.researchStatuses || []);
      setFilterCounts(c.filterCounts || {});
      setCount(c.count);
      setTotalCount(c.totalCount);
      setCampaigns(ca.items);
      setTemplates(t.items);
      setDelivery(d);
      setDashboard(db);
      setGmailMatching(gm);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [
    q,
    category,
    league,
    city,
    team,
    emailFilter,
    researchStatus,
    sendable,
    page,
    pageSize,
  ]);
  React.useEffect(() => {
    load();
  }, [load]);
  React.useEffect(() => {
    if (!gmailMatching?.configured || gmailAutoSyncStarted.current) return;
    gmailAutoSyncStarted.current = true;
    jsonFetch("/api/admin/outreach/gmail-sync", { method: "POST" })
      .then((result) => {
        if (result.matched) setNotice(`Gmail automatically linked ${result.matched} new repl${result.matched === 1 ? "y" : "ies"}.`);
      })
      .catch(() => undefined);
  }, [gmailMatching?.configured]);
  React.useEffect(() => {
    setPage(1);
  }, [q, category, league, city, team, emailFilter, researchStatus, sendable]);
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) {
        next.delete(id);
        setError(null);
        return next;
      }
      if (next.size >= MAX_CAMPAIGN_CONTACTS) {
        setError(
          `You can select up to ${MAX_CAMPAIGN_CONTACTS} contacts for each campaign.`,
        );
        return old;
      }
      next.add(id);
      setError(null);
      return next;
    });
  const updateBasis = async (contact: Contact, basis: string) => {
    try {
      await jsonFetch("/api/admin/outreach/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: contact.id,
          consentBasis: basis,
          consentEvidence:
            basis === "CONSPICUOUSLY_PUBLISHED"
              ? `Address and relevant role evidenced by ${contact.sourceUrl || "official source"}`
              : contact.consentEvidence,
        }),
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const updateContact = async (
    contact: Contact,
    changes: Record<string, unknown>,
  ) => {
    try {
      await jsonFetch("/api/admin/outreach/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: contact.id, ...changes }),
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const scheduleFollowUp = async (contact: Contact) => {
    const value = prompt(
      "Follow-up date and time (YYYY-MM-DD HH:MM), or leave blank to clear",
      contact.followUpAt
        ? new Date(contact.followUpAt)
            .toISOString()
            .slice(0, 16)
            .replace("T", " ")
        : "",
    );
    if (value === null) return;
    const parsed = value.trim() ? new Date(value) : null;
    if (value.trim() && Number.isNaN(parsed!.getTime())) {
      setError("Enter a valid date and time.");
      return;
    }
    await updateContact(contact, {
      followUpAt: parsed?.toISOString() || null,
      engagementStage: parsed ? "FOLLOW_UP" : contact.engagementStage,
    });
  };
  const editNotes = async (contact: Contact) => {
    const value = prompt("Private contact notes", contact.adminNotes || "");
    if (value !== null) await updateContact(contact, { adminNotes: value });
  };
  const openTimeline = async (contact: Contact) => {
    try {
      const data = await jsonFetch(
        `/api/admin/outreach/contacts/${contact.id}/timeline`,
      );
      setTimeline(data.item);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const saveCommunication = async () => {
    if (!communicationContact) return;
    try {
      await jsonFetch(`/api/admin/outreach/contacts/${communicationContact.id}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...communication,
          occurredAt: new Date(communication.occurredAt).toISOString(),
          followUpAt: communication.followUpAt ? new Date(communication.followUpAt).toISOString() : null,
        }),
      });
      setNotice("Communication added to the contact timeline.");
      setCommunicationContact(null);
      setCommunication({ type: "CALL", occurredAt: ontarioDateTimeInput(), subject: "", notes: "", followUpAt: "" });
      await load();
    } catch (e: any) { setError(e.message); }
  };
  const syncGmail = async () => {
    try {
      const result = await jsonFetch("/api/admin/outreach/gmail-sync", { method: "POST" });
      setNotice(`Gmail checked: ${result.matched} new repl${result.matched === 1 ? "y" : "ies"} linked; ${result.ignored} unmatched.`);
      await load();
    } catch (e: any) { setError(e.message); }
  };
  const createCampaign = async () => {
    setError(null);
    setNotice(null);
    try {
      const data = await jsonFetch("/api/admin/outreach/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...compose, contactIds: [...selected] }),
      });
      setNotice(
        `Campaign created with ${data.item._count.recipients} recipient(s)${data.skipped ? `; ${data.skipped} selection(s) skipped${data.skippedRecent ? `, including ${data.skippedRecent} contacted in the last 30 days` : ""}` : ""}.`,
      );
      setSelected(new Set());
      setCompose((x) => ({ ...x, name: "" }));
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const saveTemplate = async () => {
    const name = prompt("Template name");
    if (!name) return;
    try {
      await jsonFetch("/api/admin/outreach/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          subject: compose.subject,
          bodyText: compose.bodyText,
          bodyHtml: compose.bodyHtml,
        }),
      });
      setNotice("Template saved.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const deleteTemplate = async (template: Template) => {
    const confirmation = prompt(
      `This removes the saved template from your template list. Existing campaigns will remain unchanged.\n\nType the exact template name to confirm:\n${template.name}`,
    );
    if (confirmation === null) return;
    try {
      await jsonFetch("/api/admin/outreach/templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: template.id, confirmation }),
      });
      setNotice(`Deleted template “${template.name}”.`);
      setReviewTemplateId("");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const send = async (campaign: Campaign) => {
    if (!delivery?.configured) {
      setError("Email delivery setup is not complete yet.");
      return;
    }
    const confirmation = prompt(
      `This sends up to ${MAX_CAMPAIGN_CONTACTS} individual emails from marc@truefantix.com now. Type the exact campaign name to confirm:\n\n${campaign.name}`,
    );
    if (confirmation === null) return;
    try {
      const data = await jsonFetch(
        `/api/admin/outreach/campaigns/${campaign.id}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation, limit: MAX_CAMPAIGN_CONTACTS }),
        },
      );
      setNotice(
        `Sent ${data.sent}; failed ${data.failed}; ${data.remaining} still pending.`,
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const deleteCampaign = async (campaign: Campaign) => {
    const confirmation = prompt(
      `This permanently deletes this unsent draft and all of its pending messages.\n\nType the exact campaign name to confirm:\n${campaign.name}`,
    );
    if (confirmation === null) return;
    setError(null);
    try {
      await jsonFetch(`/api/admin/outreach/campaigns/${campaign.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      setNotice(`Deleted unsent campaign “${campaign.name}”.`);
      if (review?.id === campaign.id) setReview(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const selectReviewRecipient = (
    campaignReview: CampaignReview,
    index: number,
  ) => {
    const recipient = campaignReview.recipients[index];
    setReviewIndex(index);
    setReviewDraft({
      subject: recipient.subjectSnapshot,
      bodyText: recipient.bodyTextSnapshot,
      bodyHtml:
        recipient.bodyHtmlSnapshot || plainTextHtml(recipient.bodyTextSnapshot),
    });
  };
  const openReview = async (campaign: Campaign) => {
    setError(null);
    try {
      const data = await jsonFetch(
        `/api/admin/outreach/campaigns/${campaign.id}`,
      );
      setReview(data.item);
      selectReviewRecipient(data.item, 0);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const saveRecipient = async () => {
    if (!review) return;
    const recipient = review.recipients[reviewIndex];
    setReviewSaving(true);
    setError(null);
    try {
      const data = await jsonFetch(
        `/api/admin/outreach/campaigns/${review.id}/recipients/${recipient.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reviewDraft),
        },
      );
      const next = {
        ...review,
        recipients: review.recipients.map((item) =>
          item.id === recipient.id ? { ...item, ...data.item } : item,
        ),
      };
      setReview(next);
      setNotice(`Saved the individual message for ${recipient.emailSnapshot}.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReviewSaving(false);
    }
  };
  const suppress = async () => {
    const email = prompt("Email address to suppress globally");
    if (!email) return;
    try {
      await jsonFetch("/api/admin/outreach/suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, reason: "MANUAL" }),
      });
      setNotice(`${email} added to the do-not-contact list.`);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const testDelivery = async () => {
    setError(null);
    setNotice(null);
    try {
      const data = await jsonFetch("/api/admin/outreach/test-delivery", {
        method: "POST",
      });
      setNotice(
        `Test accepted by ${data.provider} for ${data.recipient}. Check that inbox and spam folder.`,
      );
    } catch (e: any) {
      setError(e.message);
    }
  };
  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (t)
      setCompose((x) => ({
        ...x,
        subject: t.subject,
        bodyText: t.bodyText,
        bodyHtml: t.bodyHtml || plainTextHtml(t.bodyText),
      }));
  };
  const previewContact = contacts.find((contact) => selected.has(contact.id));
  const preview = (value: string) => {
    if (!previewContact) return value;
    const firstName =
      (previewContact.contactName || "").trim().split(/\s+/)[0] || "there";
    const values: Record<string, string> = {
      firstName,
      contactName: previewContact.contactName || "",
      organization: previewContact.organization || "",
      subjectName: previewContact.subjectName || "",
      role: previewContact.role || "",
      email: previewContact.email || "",
    };
    return value.replace(
      /{{\s*([a-zA-Z][\w]*)\s*}}/g,
      (_match, key) => values[key] || "",
    );
  };
  return (
    <main style={{ maxWidth: 1280, margin: "32px auto", padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 30 }}>Outreach & contacts</h1>
          <div style={{ marginTop: 6 }}>
            <Link href="/admin">← Admin</Link> · Evidence-backed contacts,
            campaigns, history and suppression
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: delivery?.configured ? "#dcfce7" : "#fef3c7",
            }}
          >
            {delivery?.configured
              ? "Sender ready: marc@truefantix.com · replies go directly to marc@truefantix.com"
              : "Email delivery setup required—sending is disabled"}
          </span>
          {delivery?.configured && (
            <button style={button} onClick={testDelivery}>
              Send test to me
            </button>
          )}
          <button
            style={{ ...button, opacity: gmailMatching?.configured ? 1 : 0.55 }}
            disabled={!gmailMatching?.configured}
            title={gmailMatching?.configured ? "Link new replies from marc@truefantix.com to contact timelines" : "Gmail reply matching needs authorization"}
            onClick={syncGmail}
          >
            Sync Gmail replies
          </button>
          <button style={button} onClick={suppress}>
            Add suppression
          </button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 14,
            padding: 12,
            background: "#fee2e2",
            borderRadius: 8,
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            background: "#dcfce7",
            borderRadius: 8,
            color: "#166534",
          }}
        >
          {notice}
        </div>
      )}
      <section
        style={{
          marginTop: 18,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Outreach health</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))",
            gap: 10,
          }}
        >
          {[
            ["Campaigns", dashboard?.campaignCount || 0],
            ["Queued", dashboard?.recipients.PENDING || 0],
            ["Sent", dashboard?.recipients.SENT || 0],
            ["Delivered", dashboard?.recipients.DELIVERED || 0],
            ["Bounced", dashboard?.recipients.BOUNCED || 0],
            ["Complaints", dashboard?.recipients.COMPLAINED || 0],
            ["Unsubscribed", dashboard?.suppressions.UNSUBSCRIBED || 0],
            [
              "Suppressed",
              Object.values(dashboard?.suppressions || {}).reduce(
                (a, b) => a + b,
                0,
              ),
            ],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              style={{
                padding: 12,
                borderRadius: 9,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                {label}
              </div>
              <div style={{ fontSize: 25, fontWeight: 800, marginTop: 3 }}>
                {Number(value).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
        {dashboard && !dashboard.webhookConfigured && (
          <p
            style={{
              padding: 10,
              background: "#fef3c7",
              borderRadius: 8,
              marginBottom: 0,
            }}
          >
            <strong>Delivery tracking setup required:</strong> sending works,
            but Resend bounce and complaint events will not be received until
            the webhook signing secret is configured.
          </p>
        )}
        {dashboard?.recentEvents?.length ? (
          <div style={{ marginTop: 14 }}>
            <strong>Recent delivery events</strong>
            {dashboard.recentEvents.map((event) => (
              <div
                key={event.id}
                style={{
                  fontSize: 13,
                  padding: "7px 0",
                  borderBottom: "1px solid #eee",
                }}
              >
                <strong>
                  {event.type.replace("email.", "").replace("_", " ")}
                </strong>{" "}
                · {event.email} · {event.campaignName} ·{" "}
                {new Date(event.occurredAt).toLocaleString()}
                {event.detail ? ` · ${event.detail}` : ""}
              </div>
            ))}
          </div>
        ) : null}
      </section>
      <section
        style={{
          marginTop: 18,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
        }}
      >
        <h2 style={{ marginTop: 0 }}>1. Choose contacts</h2>
        <p
          style={{
            margin: "-4px 0 14px",
            padding: 10,
            background: "#eff6ff",
            borderRadius: 8,
            color: "#1e3a8a",
          }}
        >
          <strong>Select up to {MAX_CAMPAIGN_CONTACTS} contacts per campaign.</strong>{" "}
          Each send can deliver a maximum of {MAX_CAMPAIGN_CONTACTS} individual messages.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
            gap: 8,
          }}
        >
          <input
            style={field}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search contacts"
          />
          <select
            style={field}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories ({totalCount.toLocaleString()})</option>
            {categories.map((x) => (
              <option key={x} value={x}>{categoryLabels[x] || x} ({(filterCounts.categories?.[x] || 0).toLocaleString()})</option>
            ))}
          </select>
          <select
            style={field}
            value={league}
            onChange={(e) => setLeague(e.target.value)}
          >
            <option value="">All sports / leagues</option>
            {leagues.map((x) => (
              <option key={x} value={x}>{x} ({(filterCounts.leagues?.[x] || 0).toLocaleString()})</option>
            ))}
          </select>
          <select
            style={field}
            value={city}
            onChange={(e) => setCity(e.target.value)}
          >
            <option value="">All cities</option>
            {cities.map((x) => (
              <option key={x} value={x}>{x} ({(filterCounts.cities?.[x] || 0).toLocaleString()})</option>
            ))}
          </select>
          <select
            style={field}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">All teams / artists</option>
            {teams.map((x) => (
              <option key={x} value={x}>{x} ({(filterCounts.teams?.[x] || 0).toLocaleString()})</option>
            ))}
          </select>
          <select
            style={field}
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
          >
            <option value="">All email statuses</option>
            <option value="yes">Has email address</option>
            <option value="no">No email address</option>
          </select>
          <select
            style={field}
            value={researchStatus}
            onChange={(e) => setResearchStatus(e.target.value)}
          >
            <option value="">All research statuses</option>
            {researchStatuses.map((x) => (
              <option key={x} value={x}>
                {researchLabels[x] || x} ({(filterCounts.researchStatuses?.[x] || 0).toLocaleString()})
              </option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <input
              type="checkbox"
              checked={sendable}
              onChange={(e) => setSendable(e.target.checked)}
            />
            Show sendable only
          </label>
          <button style={button} onClick={load}>
            Refresh
          </button>
          <button
            style={button}
            onClick={() => {
              setQ("");
              setCategory("");
              setLeague("");
              setCity("");
              setTeam("");
              setEmailFilter("");
              setResearchStatus("");
              setSendable(false);
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
        <p style={{ fontSize: 13, opacity: 0.72 }}>
          <strong>{count.toLocaleString()}</strong> matching contacts out of{" "}
          <strong>{totalCount.toLocaleString()}</strong>.{" "}
          <strong>Researched</strong> means the source was checked and a contact
          route was recorded; <strong>Verified</strong> means that contact
          evidence received an additional validation pass. Neither badge
          overrides unsubscribe or contact-basis safeguards.
        </p>
        <div style={{ overflowX: "auto" }}>
          {!loading && contacts.length === 0 && (
            <p style={{ padding: 14, background: "#f8fafc", borderRadius: 8 }}>
              No contacts match these filters.
              {sendable
                ? " No contacts in this selection have completed contact-basis review yet."
                : " Try clearing one or more filters."}
            </p>
          )}
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr>
                {[
                  "Pick",
                  "Organization / subject",
                  "Research",
                  "Contact",
                  "Email",
                  "Evidence",
                  "Contact basis",
                  "Relationship",
                ].map((x) => (
                  <th
                    key={x}
                    style={{
                      padding: 8,
                      textAlign: "left",
                      borderBottom: "1px solid #ddd",
                    }}
                  >
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const blocked = !!c.suppressionReason || !!c.unsubscribedAt;
                const status = c.researchStatus || "PENDING";
                return (
                  <tr
                    key={c.id}
                    style={{
                      opacity: blocked ? 0.6 : 1,
                      background: status === "PENDING" ? "#fffbeb" : undefined,
                    }}
                  >
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        disabled={
                          !c.email ||
                          blocked ||
                          (!selected.has(c.id) && selected.size >= MAX_CAMPAIGN_CONTACTS)
                        }
                      />
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      <strong>{c.organization || c.subjectName || "—"}</strong>
                      <br />
                      <span style={{ opacity: 0.7 }}>
                        {c.subjectName !== c.organization ? c.subjectName : ""}{" "}
                        {[c.league, c.city, c.region]
                          .filter(Boolean)
                          .join(" · ") || c.category}
                      </span>
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      <span
                        title={
                          status === "VERIFIED"
                            ? "Contact evidence received an additional validation pass."
                            : status === "RESEARCHED"
                              ? "Source checked and a contact route recorded."
                              : undefined
                        }
                        style={{
                          display: "inline-block",
                          padding: "4px 7px",
                          borderRadius: 999,
                          background: researchColors[status] || "#f1f5f9",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {researchLabels[status] || status}
                      </span>
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {c.contactName || "Departmental contact"}
                      <br />
                      <span style={{ opacity: 0.7 }}>{c.role}</span>
                    </td>
                    <td
                      style={{
                        padding: 8,
                        borderBottom: "1px solid #eee",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {c.email || "No public email"}
                      {blocked && (
                        <>
                          <br />
                          <strong style={{ color: "#991b1b" }}>
                            DO NOT CONTACT
                          </strong>
                        </>
                      )}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {c.sourceUrl ? (
                        <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                          Official source
                        </a>
                      ) : (
                        "Missing"
                      )}
                      <br />
                      <span style={{ opacity: 0.7 }}>
                        {c.confidence}{" "}
                        {c.verifiedAt
                          ? new Date(c.verifiedAt).toLocaleDateString()
                          : ""}
                      </span>
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      <select
                        style={{ ...field, padding: 6 }}
                        value={c.consentBasis}
                        onChange={(e) => updateBasis(c, e.target.value)}
                      >
                        <option value="UNASSESSED">Unassessed</option>
                        <option value="CONSPICUOUSLY_PUBLISHED">
                          Published business address
                        </option>
                        <option value="EXPRESS_CONSENT">Express consent</option>
                        <option value="EXISTING_BUSINESS_RELATIONSHIP">
                          Existing relationship
                        </option>
                        <option value="NOT_REQUIRED">Not required</option>
                      </select>
                    </td>
                    <td
                      style={{
                        padding: 8,
                        borderBottom: "1px solid #eee",
                        minWidth: 190,
                      }}
                    >
                      <select
                        style={{ ...field, padding: 6, width: "100%" }}
                        value={c.engagementStage}
                        onChange={(e) =>
                          updateContact(c, { engagementStage: e.target.value })
                        }
                      >
                        {stages.map((stage) => (
                          <option key={stage} value={stage}>
                            {stage.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                      <div style={{ marginTop: 5 }}>
                        {c.followUpAt
                          ? `Follow up ${new Date(c.followUpAt).toLocaleString()}`
                          : c.lastContactedAt
                            ? `Last sent ${new Date(c.lastContactedAt).toLocaleDateString()}`
                            : "Never contacted"}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 7,
                          marginTop: 5,
                        }}
                      >
                        <button
                          style={{ ...button, padding: "4px 7px" }}
                          onClick={() => scheduleFollowUp(c)}
                        >
                          Follow-up
                        </button>
                        <button
                          style={{ ...button, padding: "4px 7px" }}
                          onClick={() => editNotes(c)}
                        >
                          Notes
                        </button>
                        <button
                          type="button"
                          style={{ ...button, padding: "4px 7px" }}
                          onClick={() => openTimeline(c)}
                        >
                          Timeline
                        </button>
                        <button
                          type="button"
                          style={{ ...button, padding: "4px 7px" }}
                          onClick={() => {
                            setCommunication((current) => ({
                              ...current,
                              occurredAt: ontarioDateTimeInput(),
                            }));
                            setCommunicationContact(c);
                          }}
                        >
                          Add communication
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loading && <p>Loading…</p>}
        {!loading && count > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid #e5e7eb",
            }}
          >
            <span style={{ fontSize: 13 }}>
              Showing {((page - 1) * pageSize + 1).toLocaleString()}–
              {Math.min(page * pageSize, count).toLocaleString()} of{" "}
              {count.toLocaleString()} matching contacts
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                style={{ ...button, opacity: page === 1 ? 0.5 : 1 }}
                disabled={page === 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                ← Previous
              </button>
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                Page {page} of {Math.max(1, Math.ceil(count / pageSize))}
              </span>
              <button
                style={{
                  ...button,
                  opacity: page * pageSize >= count ? 0.5 : 1,
                }}
                disabled={page * pageSize >= count || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        )}
        {timeline && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Communication timeline"
            onClick={() => setTimeline(null)}
            style={dialogBackdrop}
          >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              ...dialogPanel,
              padding: 14,
              border: "1px solid #93c5fd",
              borderRadius: 9,
              background: "#eff6ff",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <strong>
                Communication timeline —{" "}
                {timeline.organization ||
                  timeline.subjectName ||
                  timeline.email}
              </strong>
              <button style={button} onClick={() => setTimeline(null)}>
                Close
              </button>
            </div>
            {timeline.adminNotes && (
              <p>
                <strong>Notes:</strong> {timeline.adminNotes}
              </p>
            )}
            {[
              ...(timeline.recipients || []).flatMap((r: any) => [
                {
                  kind: "Sent",
                  at: r.sentAt || r.createdAt,
                  subject: r.subjectSnapshot,
                  detail: `${r.campaign.name} · ${r.status}`,
                  message: r.bodyTextSnapshot,
                },
                ...(r.events || []).map((e: any) => ({
                  kind: e.type.replace("email.", ""),
                  at: e.occurredAt,
                  subject: r.subjectSnapshot,
                  detail: e.detail,
                })),
              ]),
              ...(timeline.replies || []).map((r: any) => ({
                kind: "Reply",
                at: r.receivedAt,
                subject: r.subject,
                detail: `From ${r.fromEmail}`,
                message: r.textBody || "This reply only contains HTML content.",
              })),
              ...(timeline.communications || []).map((c: any) => ({
                kind: c.type.replaceAll("_", " ").toLowerCase().replace(/^./, (x: string) => x.toUpperCase()),
                at: c.occurredAt,
                subject: c.subject,
                detail: c.notes || "",
                message: c.notes || "",
              })),
            ]
              .sort(
                (a: any, b: any) =>
                  new Date(b.at).getTime() - new Date(a.at).getTime(),
              )
              .map((event: any, index: number) => (
                <div
                  key={`${event.kind}-${event.at}-${index}`}
                  style={{
                    padding: "9px 0",
                    borderBottom: "1px solid #bfdbfe",
                  }}
                >
                  <strong>{event.kind}</strong> ·{" "}
                  {new Date(event.at).toLocaleString()} · {event.subject}
                  {event.detail && (
                    <div style={{ marginTop: 3, opacity: 0.78 }}>
                      {event.detail}
                    </div>
                  )}
                  {event.message && (
                    <details style={{ marginTop: 7 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 800 }}>
                        {event.kind === "Reply" ? "Read reply" : "Read message"}
                      </summary>
                      <div
                        style={{
                          whiteSpace: "pre-wrap",
                          marginTop: 7,
                          padding: 10,
                          borderRadius: 7,
                          background: "rgba(255,255,255,.72)",
                          maxHeight: 260,
                          overflow: "auto",
                        }}
                      >
                        {event.message}
                      </div>
                    </details>
                  )}
                </div>
              ))}
          </div>
          </div>
        )}
        {communicationContact && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add communication"
            onClick={() => setCommunicationContact(null)}
            style={dialogBackdrop}
          >
          <div onClick={(event) => event.stopPropagation()} style={{ ...dialogPanel, padding: 14, border: "1px solid #86efac", borderRadius: 9, background: "#f0fdf4" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong>Add communication — {communicationContact.organization || communicationContact.subjectName || communicationContact.email}</strong>
              <button style={button} onClick={() => setCommunicationContact(null)}>Cancel</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginTop: 12 }}>
              <label>Type<select style={{ ...field, display: "block", width: "100%", marginTop: 4 }} value={communication.type} onChange={(e) => setCommunication((x) => ({ ...x, type: e.target.value }))}>
                <option value="CALL">Call</option><option value="MEETING">Meeting</option><option value="DIRECT_EMAIL">Direct email</option><option value="SOCIAL_MESSAGE">Social message</option><option value="CONTACT_FORM">Contact form</option><option value="OTHER">Other</option>
              </select></label>
              <label>Date and time<input type="datetime-local" style={{ ...field, display: "block", width: "100%", marginTop: 4 }} value={communication.occurredAt} onChange={(e) => setCommunication((x) => ({ ...x, occurredAt: e.target.value }))} /></label>
              <label>Optional next follow-up<input type="datetime-local" style={{ ...field, display: "block", width: "100%", marginTop: 4 }} value={communication.followUpAt} onChange={(e) => setCommunication((x) => ({ ...x, followUpAt: e.target.value }))} /></label>
            </div>
            <label style={{ display: "block", marginTop: 10 }}>Subject<input style={{ ...field, display: "block", width: "100%", marginTop: 4 }} value={communication.subject} onChange={(e) => setCommunication((x) => ({ ...x, subject: e.target.value }))} /></label>
            <label style={{ display: "block", marginTop: 10 }}>Notes<textarea rows={4} style={{ ...field, display: "block", width: "100%", marginTop: 4 }} value={communication.notes} onChange={(e) => setCommunication((x) => ({ ...x, notes: e.target.value }))} /></label>
            <button style={{ ...button, marginTop: 10, background: "#166534", color: "white" }} disabled={!communication.subject.trim() || !communication.occurredAt} onClick={saveCommunication}>Save to Timeline</button>
          </div>
          </div>
        )}
      </section>
      <section
        style={{
          marginTop: 18,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
        }}
      >
        <h2 style={{ marginTop: 0 }}>
          2. Prepare campaign{" "}
          <small style={{ fontWeight: 400 }}>({selected.size} selected)</small>
        </h2>
        <div style={{ display: "grid", gap: 9 }}>
          <input
            style={field}
            placeholder="Campaign name"
            value={compose.name}
            onChange={(e) => setCompose({ ...compose, name: e.target.value })}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <select
              style={field}
              defaultValue=""
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="">Load a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button style={button} onClick={saveTemplate}>
              Save current as template
            </button>
          </div>
          <input
            style={field}
            placeholder="Subject — supports {{firstName}}, {{organization}}, {{subjectName}}, {{role}}"
            value={compose.subject}
            onChange={(e) =>
              setCompose({ ...compose, subject: e.target.value })
            }
          />
          <RichTextEditor
            value={compose.bodyHtml}
            onChange={(bodyHtml, bodyText) =>
              setCompose((current) => ({ ...current, bodyHtml, bodyText }))
            }
          />
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: 12,
              borderRadius: 8,
              background: compose.allowRecentContact ? "#fff7ed" : "#f0fdf4",
              border: `1px solid ${compose.allowRecentContact ? "#fdba74" : "#bbf7d0"}`,
            }}
          >
            <input
              type="checkbox"
              checked={compose.allowRecentContact}
              onChange={(e) => setCompose({ ...compose, allowRecentContact: e.target.checked })}
            />
            <span>
              <strong>Allow re-contact within 30 days</strong>
              <br />
              Leave this off for normal outreach. Turn it on only for an expected follow-up or another deliberate exception.
            </span>
          </label>
          {previewContact && (
            <div
              style={{
                padding: 14,
                border: "1px solid #bfdbfe",
                borderRadius: 8,
                background: "#eff6ff",
              }}
            >
              <strong>Personalized preview for {previewContact.email}</strong>
              <div style={{ marginTop: 8 }}>
                <strong>Subject:</strong>{" "}
                {preview(compose.subject) || "(empty)"}
              </div>
              <div
                className="outreach-rich-content"
                style={{
                  marginTop: 12,
                  padding: 16,
                  background: "white",
                  borderRadius: 6,
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 16,
                  lineHeight: 1.55,
                }}
                dangerouslySetInnerHTML={{
                  __html: safePreviewHtml(preview(compose.bodyHtml)),
                }}
              />
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: "1px solid #cbd5e1",
                  fontSize: 12,
                  color: "#64748b",
                }}
              >
                The legal business footer and each recipient’s unique
                unsubscribe link will be added automatically when sent.
              </div>
            </div>
          )}
          <button
            style={{
              ...button,
              background: "#0f172a",
              color: "white",
              justifySelf: "start",
            }}
            disabled={!selected.size}
            onClick={createCampaign}
          >
            Create reviewed draft campaign
          </button>
        </div>
      </section>
      <section
        style={{
          marginTop: 18,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
        }}
      >
        <h2 style={{ marginTop: 0 }}>3. Review and send campaigns</h2>
        {campaigns.length === 0 ? (
          <p>No campaigns yet.</p>
        ) : (
          campaigns.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 0",
                borderBottom: "1px solid #eee",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong>{c.name}</strong> · {c.status}
                <br />
                <span style={{ fontSize: 13, opacity: 0.72 }}>
                  {c._count.recipients} recipient(s) ·{" "}
                  {Object.entries(c.statusCounts || {})
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                  {c.allowRecentContact ? " · 30-day safeguard overridden" : " · 30-day safeguard active"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={button} onClick={() => openReview(c)}>
                  Preview each message
                </button>
                {c.status === "DRAFT" &&
                  (c.statusCounts.PENDING || 0) === c._count.recipients && (
                    <button
                      style={{ ...button, color: "#b91c1c", borderColor: "#fecaca" }}
                      onClick={() => deleteCampaign(c)}
                    >
                      Delete campaign
                    </button>
                  )}
                {["DRAFT", "SENDING"].includes(c.status) && (
                  <button
                    style={{ ...button, background: "#064a93", color: "white" }}
                    onClick={() => send(c)}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </section>
      {review && review.recipients.length > 0 && (
        <section
          style={{
            marginTop: 18,
            padding: 16,
            border: "2px solid #2563eb",
            borderRadius: 10,
            background: "#eff6ff",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "start",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ margin: 0 }}>
                Individual message review — {review.name}
              </h2>
              <p style={{ margin: "6px 0 0", color: "#475569" }}>
                Message {reviewIndex + 1} of {review.recipients.length}. Changes
                here apply only to this recipient.
              </p>
            </div>
            <button style={button} onClick={() => setReview(null)}>
              Close review
            </button>
          </div>
          {(() => {
            const recipient = review.recipients[reviewIndex];
            const editable = recipient.status === "PENDING";
            return (
              <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    style={button}
                    disabled={reviewIndex === 0}
                    onClick={() =>
                      selectReviewRecipient(review, reviewIndex - 1)
                    }
                  >
                    ← Previous
                  </button>
                  <div style={{ textAlign: "center" }}>
                    <strong>
                      {recipient.contact.contactName || "Departmental contact"}
                    </strong>{" "}
                    ·{" "}
                    {recipient.contact.organization ||
                      recipient.contact.subjectName ||
                      "No organization"}
                    <br />
                    <span style={{ fontSize: 13 }}>
                      {recipient.emailSnapshot} · {recipient.status}
                    </span>
                  </div>
                  <button
                    style={button}
                    disabled={reviewIndex === review.recipients.length - 1}
                    onClick={() =>
                      selectReviewRecipient(review, reviewIndex + 1)
                    }
                  >
                    Next →
                  </button>
                </div>
                <label style={{ fontWeight: 800 }}>
                  Subject
                  <input
                    style={{
                      ...field,
                      display: "block",
                      width: "100%",
                      marginTop: 5,
                      boxSizing: "border-box",
                    }}
                    value={reviewDraft.subject}
                    disabled={!editable}
                    onChange={(e) =>
                      setReviewDraft((current) => ({
                        ...current,
                        subject: e.target.value,
                      }))
                    }
                  />
                </label>
                <div>
                  <strong>Message</strong>
                  <div style={{ marginTop: 5 }}>
                    <RichTextEditor
                      value={reviewDraft.bodyHtml}
                      readOnly={!editable}
                      onChange={(bodyHtml, bodyText) =>
                        setReviewDraft((current) => ({
                          ...current,
                          bodyHtml,
                          bodyText,
                        }))
                      }
                    />
                  </div>
                </div>
                <div
                  style={{
                    padding: 12,
                    borderTop: "1px solid #cbd5e1",
                    fontSize: 12,
                    color: "#64748b",
                  }}
                >
                  The legal TrueFanTix address, commercial-message notice, and
                  this recipient’s unique unsubscribe link will still be added
                  automatically.
                </div>
                {editable ? (
                  <button
                    style={{
                      ...button,
                      background: "#166534",
                      color: "white",
                      justifySelf: "start",
                    }}
                    disabled={reviewSaving}
                    onClick={saveRecipient}
                  >
                    {reviewSaving
                      ? "Saving…"
                      : "Save changes for this recipient"}
                  </button>
                ) : (
                  <div
                    style={{
                      padding: 10,
                      background: "#f1f5f9",
                      borderRadius: 8,
                    }}
                  >
                    This message has already left the pending queue and can no
                    longer be edited.
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      )}
      <section
        style={{
          marginTop: 18,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>4. Saved templates</h2>
            <p style={{ margin: "5px 0 0", color: "#64748b" }}>
              Review a template’s complete subject and message before removing
              it.
            </p>
          </div>
          <button
            style={button}
            onClick={() => setTemplateManagerOpen((open) => !open)}
          >
            {templateManagerOpen
              ? "Close templates"
              : "Review/delete templates"}
          </button>
        </div>
        {templateManagerOpen && (
          <div style={{ marginTop: 14 }}>
            <select
              style={{ ...field, minWidth: 260 }}
              value={reviewTemplateId}
              onChange={(e) => setReviewTemplateId(e.target.value)}
            >
              <option value="">Choose a template to review…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {(() => {
              const template = templates.find((t) => t.id === reviewTemplateId);
              return template ? (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    background: "#f8fafc",
                  }}
                >
                  <h3 style={{ margin: "0 0 8px" }}>{template.name}</h3>
                  <div>
                    <strong>Subject:</strong> {template.subject}
                  </div>
                  <div
                    className="outreach-rich-content"
                    style={{
                      marginTop: 10,
                      padding: 14,
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      background: "white",
                    }}
                    dangerouslySetInnerHTML={{
                      __html: safePreviewHtml(
                        template.bodyHtml || plainTextHtml(template.bodyText),
                      ),
                    }}
                  />
                  <button
                    style={{
                      ...button,
                      marginTop: 12,
                      background: "#b91c1c",
                      color: "white",
                    }}
                    onClick={() => deleteTemplate(template)}
                  >
                    Delete this template
                  </button>
                </div>
              ) : (
                <p style={{ color: "#64748b" }}>
                  {templates.length
                    ? "Select a template above to preview it."
                    : "There are no saved templates."}
                </p>
              );
            })()}
          </div>
        )}
      </section>
      <style jsx global>{`
        .outreach-rich-content p {
          margin: 0 0 16px;
        }
        .outreach-rich-content ul,
        .outreach-rich-content ol {
          margin: 0 0 16px;
          padding-left: 28px;
        }
        .outreach-rich-content li {
          margin: 0 0 6px;
        }
        .outreach-rich-content > :last-child {
          margin-bottom: 0;
        }
      `}</style>
    </main>
  );
}
